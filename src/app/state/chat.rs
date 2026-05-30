//! Chat message submission, streaming, and title generation.

use super::{chat_pipeline, AppState};
use crate::app::events::UiEvent;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::{
    CLAUDE_PROVIDER_URL, CODEX_PROVIDER_URL, ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT,
    fallback_session_title, sanitize_session_title, split_model_key,
};
use crate::domain::messages::*;
use crate::infra::openai::{self, OpenAiChatRequest, OpenAiContext, OpenAiMessage};
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tokio::task::AbortHandle;

#[derive(Clone)]
pub(in crate::app) struct ActiveChatResponse {
    pub(in crate::app::state) session_id: String,
    pub(in crate::app::state) assistant_message_id: String,
    pub(in crate::app::state) abort_handle: AbortHandle,
}

#[derive(Clone)]
struct PendingChatResponse {
    session_id: String,
    assistant_message_id: String,
    ctx: OpenAiContext,
    request: OpenAiChatRequest,
}

#[derive(Clone)]
struct PendingTitleResponse {
    session_id: String,
    fallback_title: String,
    ctx: OpenAiContext,
    request: OpenAiChatRequest,
}

impl AppState {
    /// Queues a user message, starts streaming, and returns the updated snapshot.
    pub fn send_message(
        &self,
        input: SendMessageRequest,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        self.validate_can_send(&input)?;
        if self.selected_provider_is_codex()? {
            return self.send_codex_message(input, app_handle);
        }
        if self.selected_provider_is_claude()? {
            return self.send_claude_message(input, app_handle);
        }
        self.ensure_provider_ready()?;
        let (ctx, selected_model) = self.selected_provider_context()?;
        let (work, title_work) = self.prepare_chat_work(input, &ctx, &selected_model)?;
        let (chat_state, chat_app_handle) = (self.clone(), app_handle.clone());
        chat_pipeline::spawn_chat_stream(
            self,
            work.session_id.clone(),
            work.assistant_message_id.clone(),
            chat_app_handle.clone(),
            async move {
                chat_state.execute_chat_response(work, chat_app_handle).await
            },
        );
        if let Some(title_work) = title_work {
            let title_state = self.clone();
            chat_pipeline::spawn_title_stream(self, app_handle, async move {
                title_state.execute_title_response(title_work).await
            });
        }
        self.snapshot()
    }

    /// Validates that input is not empty and a message can be sent.
    fn validate_can_send(&self, input: &SendMessageRequest) -> Result<()> {
        if input.text.trim().is_empty() && input.image_data_urls.is_empty() {
            return Err(anyhow!(ERR_VALIDATION_EMPTY_MESSAGE));
        }
        Ok(())
    }

    /// Locks state, validates readiness, builds messages, and returns
    /// the pending chat response plus an optional title-response task.
    fn prepare_chat_work(
        &self,
        input: SendMessageRequest,
        ctx: &OpenAiContext,
        selected_model: &str,
    ) -> Result<(PendingChatResponse, Option<PendingTitleResponse>)> {
        let text = input.text.trim().to_owned();
        let image_data_urls = input.image_data_urls;
        let mut inner = self.lock()?;
        let session_id = inner.settings.active_session_id.clone();
        if inner.active_chat_responses.contains_key(&session_id) {
            return Err(anyhow!(
                ERR_VALIDATION_STOP_FIRST
            ));
        }
        inner.save_active_session_model_settings()?;
        let model_key = inner.settings.model.clone();
        let reasoning_effort = normalized_reasoning_effort(&inner.settings.reasoning_effort);
        let title_gen_model = inner.settings.title_gen_model.clone();
        let title_provider = resolve_title_provider(&title_gen_model, &inner.providers);
        let session = inner.active_session_mut()?;

        let user_message = ChatMessage::user(text.clone(), image_data_urls.clone());
        let should_generate_title = session.title == CHAT_DEFAULT_TITLE && session.messages.is_empty();
        let title_work = if should_generate_title {
            build_openai_title_work(
                &title_gen_model,
                title_provider.as_ref(),
                &session_id,
                &user_message,
                ctx,
                selected_model,
            )
        } else {
            None
        };

        let assistant_message = ChatMessage::assistant_placeholder();
        if session.title == CHAT_DEFAULT_TITLE {
            session.title = fallback_session_title(&user_message);
        }
        session.updated_at = Utc::now();
        session.messages.push(user_message);
        let assistant_message_id = assistant_message.id.clone();
        session.messages.push(assistant_message);

        let messages = build_context_messages(session);
        let work = PendingChatResponse {
            session_id,
            assistant_message_id,
            ctx: ctx.clone(),
            request: OpenAiChatRequest {
                model: selected_model.to_owned(),
                messages,
                reasoning_effort,
            },
        };
        inner.settings.model = model_key;
        inner.status = STATUS_GENERATING_ANSWER.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok((work, title_work))
    }

    /// Stops an active response and removes an empty assistant placeholder.
    pub fn stop_chat_response(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        let Some(active) = inner.active_chat_responses.remove(session_id) else {
            inner.status = STATUS_NO_ANSWER_RUNNING.to_owned();
            return Ok(inner.build_snapshot());
        };
        active.abort_handle.abort();
        {
            let session = inner.session_mut(&active.session_id)?;
            if let Some(index) = session
                .messages
                .iter()
                .position(|m| m.id == active.assistant_message_id)
                && session.messages[index].text.trim().is_empty()
            {
                session.messages.remove(index);
            }
            session.updated_at = Utc::now();
        }
        inner.status = STATUS_ANSWER_STOPPED.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Requests a generated title and stores it when the chat still exists.
    async fn execute_title_response(&self, work: PendingTitleResponse) -> Result<(String, String)> {
        let raw = openai::stream_chat_response(&work.ctx, work.request, |_| {}).await?;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        self.save_generated_session_title(&work.session_id, &title)?;
        Ok((work.session_id, title))
    }

    /// Streams the final answer and persists it.
    async fn execute_chat_response(
        &self,
        work: PendingChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();

        let final_answer = openai::stream_chat_response(&work.ctx, work.request, move |partial| {
            stream_state.append_streamed_text(&sid, &mid, &partial);
            Self::emit_assistant_delta_event(&app_handle, &sid, &mid, partial);
        })
        .await?;

        self.finish_successful_chat_response(
            &work.session_id,
            &work.assistant_message_id,
            final_answer,
        )
    }

    /// Appends one streamed text delta to the assistant message in memory.
    pub(in crate::app::state) fn append_streamed_text(
        &self,
        session_id: &str,
        message_id: &str,
        text: &str,
    ) {
        if text.is_empty() {
            return;
        }
        if let Ok(mut inner) = self.lock()
            && let Ok(session) = inner.session_mut(session_id)
            && let Some(msg) = session.messages.iter_mut().find(|m| m.id == message_id)
        {
            msg.text.push_str(text);
            session.updated_at = Utc::now();
        }
    }

    /// Registers a running chat response so later stop/failure paths can find it.
    pub(in crate::app::state) fn register_active_chat_response(
        &self,
        session_id: String,
        assistant_message_id: String,
        abort_handle: AbortHandle,
    ) {
        let active = ActiveChatResponse {
            session_id: session_id.clone(),
            assistant_message_id,
            abort_handle,
        };
        if let Ok(mut inner) = self.lock() {
            inner.active_chat_responses.insert(session_id, active);
        }
    }

    /// Emits a complete snapshot to the frontend event stream.
    pub(in crate::app::state) fn emit_snapshot_event(
        app_handle: &AppHandle,
        snapshot: AppSnapshot,
    ) {
        let _ = app_handle.emit(
            "app-event",
            UiEvent::Snapshot {
                snapshot: Box::new(snapshot),
            },
        );
    }

    /// Emits one streamed assistant delta to the frontend event stream.
    pub(in crate::app::state) fn emit_assistant_delta_event(
        app_handle: &AppHandle,
        session_id: &str,
        message_id: &str,
        text: String,
    ) {
        let _ = app_handle.emit(
            "app-event",
            UiEvent::AssistantDelta {
                session_id: session_id.to_owned(),
                message_id: message_id.to_owned(),
                text,
            },
        );
    }

    /// Emits a generated session title update to the frontend event stream.
    pub(in crate::app::state) fn emit_session_title_event(
        app_handle: &AppHandle,
        session_id: String,
        title: String,
    ) {
        let _ = app_handle.emit(
            "app-event",
            UiEvent::SessionTitleUpdated { session_id, title },
        );
    }

    /// Emits an error event and follows it with the newest available snapshot.
    pub(in crate::app::state) fn emit_error_snapshot(
        &self,
        app_handle: &AppHandle,
        error: anyhow::Error,
    ) {
        self.set_status(&format!("Error: {error}"));
        let _ = app_handle.emit(
            "app-event",
            UiEvent::Error {
                message: error.to_string(),
            },
        );
        if let Ok(snapshot) = self.snapshot() {
            Self::emit_snapshot_event(app_handle, snapshot);
        }
    }

    /// Stores a generated session title when the target session still has content.
    pub(in crate::app::state) fn save_generated_session_title(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<()> {
        let mut inner = self.lock()?;
        if let Ok(session) = inner.session_mut(session_id)
            && !session.messages.is_empty()
        {
            session.title = title.to_owned();
            session.updated_at = Utc::now();
            inner.storage.save_sessions(&inner.sessions)?;
        }
        Ok(())
    }

    /// Finalizes a successful stream, removes active bookkeeping, and returns a snapshot.
    pub(in crate::app::state) fn finish_successful_chat_response(
        &self,
        session_id: &str,
        assistant_message_id: &str,
        final_answer: String,
    ) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        if let Ok(session) = inner.session_mut(session_id) {
            if let Some(msg) = session
                .messages
                .iter_mut()
                .find(|m| m.id == assistant_message_id)
            {
                msg.text = final_answer;
            }
            session.updated_at = Utc::now();
        }
        if inner
            .active_chat_responses
            .get(session_id)
            .is_some_and(|a| a.assistant_message_id == assistant_message_id)
        {
            inner.active_chat_responses.remove(session_id);
        }
        inner.status = STATUS_ANSWER_READY.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Cleans up a pending assistant placeholder after a failed stream.
    pub(in crate::app::state) fn finish_failed_assistant_placeholder(
        &self,
        session_id: &str,
        assistant_message_id: &str,
    ) {
        if let Ok(mut inner) = self.lock() {
            if inner
                .active_chat_responses
                .get(session_id)
                .is_some_and(|a| a.assistant_message_id == assistant_message_id)
            {
                inner.active_chat_responses.remove(session_id);
                if let Ok(session) = inner.session_mut(session_id) {
                    if let Some(index) = session
                        .messages
                        .iter()
                        .position(|m| m.id == assistant_message_id)
                        && session.messages[index].text.trim().is_empty()
                    {
                        session.messages.remove(index);
                    }
                    session.updated_at = Utc::now();
                }
                let _ = inner.storage.save_sessions(&inner.sessions);
            }
        }
    }
}

/// Builds chat completion messages from the active session context.
fn build_context_messages(session: &crate::domain::ChatSession) -> Vec<OpenAiMessage> {
    let messages: Vec<_> = session
        .messages
        .iter()
        .filter(|m| m.has_content())
        .collect();
    let start = messages.len().saturating_sub(MESSAGE_CONTEXT_LIMIT);
    messages[start..]
        .iter()
        .map(|m| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
            };
            OpenAiMessage {
                role: role.to_owned(),
                text: m.text.clone(),
                image_data_urls: m.image_data_urls.clone(),
            }
        })
        .collect()
}

/// Builds a title-generation prompt.
pub(in crate::app::state) fn title_prompt(message: &ChatMessage) -> String {
    let text = if message.text.trim().is_empty() {
        CHAT_IMAGE_ONLY_MESSAGE.to_string()
    } else {
        message.text.trim().chars().take(2000).collect::<String>()
    };
    format!(
        "Generate a concise chat title in the same language as the user's first message. \
         Return only the title, no quotation marks, no markdown, maximum 6 words.\n\n\
         User's first message:\n{text}"
    )
}

/// Converts "none" to an omitted reasoning_effort field.
fn normalized_reasoning_effort(value: &str) -> Option<String> {
    match value {
        "low" | "medium" | "high" => Some(value.to_owned()),
        _ => None,
    }
}

/// Resolves the target provider and model for title generation.
fn resolve_title_provider(
    title_gen_model: &str,
    providers: &crate::domain::ProviderStorage,
) -> Option<(crate::domain::ProviderConfig, String)> {
    let normalized = title_gen_model.trim().to_lowercase();
    if normalized.is_empty() || normalized == "current" || normalized == "none" {
        return None;
    }
    let (provider_id, model) = split_model_key(title_gen_model)?;
    let provider = providers.provider(provider_id)?.clone();
    if provider.api_url == CODEX_PROVIDER_URL || provider.api_url == CLAUDE_PROVIDER_URL {
        return None;
    }
    Some((provider, model.to_owned()))
}

/// Builds an OpenAI title-generation work item based on the title_gen_model setting.
fn build_openai_title_work(
    title_gen_model: &str,
    title_provider: Option<&(crate::domain::ProviderConfig, String)>,
    session_id: &str,
    user_message: &ChatMessage,
    current_ctx: &OpenAiContext,
    current_model: &str,
) -> Option<PendingTitleResponse> {
    let fallback_title = fallback_session_title(user_message);
    let normalized = title_gen_model.trim().to_lowercase();
    if normalized == "none" {
        return None;
    }
    if let Some((provider, model)) = title_provider {
        let ctx = OpenAiContext::from_provider(provider);
        return Some(PendingTitleResponse {
            session_id: session_id.to_owned(),
            fallback_title,
            ctx,
            request: OpenAiChatRequest {
                model: model.clone(),
                messages: vec![OpenAiMessage {
                    role: "user".to_owned(),
                    text: title_prompt(user_message),
                    image_data_urls: Vec::new(),
                }],
                reasoning_effort: None,
            },
        });
    }
    Some(PendingTitleResponse {
        session_id: session_id.to_owned(),
        fallback_title,
        ctx: current_ctx.clone(),
        request: OpenAiChatRequest {
            model: current_model.to_owned(),
            messages: vec![OpenAiMessage {
                role: "user".to_owned(),
                text: title_prompt(user_message),
                image_data_urls: Vec::new(),
            }],
            reasoning_effort: None,
        },
    })
}
