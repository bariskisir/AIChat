//! Codex chat submission and streaming state helpers.

use super::super::AppState;
use crate::app::state::chat::title_prompt;
use crate::app::state::chat_pipeline;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::messages::*;
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, TITLE_RESPONSE_STYLE, fallback_session_title,
    sanitize_session_title,
};
use crate::infra::chatgpt;
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::AppHandle;

#[derive(Clone)]
struct PendingCodexChatResponse {
    session_id: String,
    assistant_message_id: String,
    request: chatgpt::ChatRequest,
}

#[derive(Clone)]
struct PendingCodexTitleResponse {
    session_id: String,
    fallback_title: String,
    request: chatgpt::ChatRequest,
}

impl AppState {
    /// Queues a user message for the Codex ChatGPT backend.
    pub(in crate::app::state) fn send_codex_message(
        &self,
        input: SendMessageRequest,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let text = input.text.trim().to_owned();
        let image_data_urls = input
            .image_data_urls
            .iter()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        {
            let inner = self.lock()?;
            if !inner.auth.is_signed_in() {
                return Err(anyhow!(AUTH_SIGN_IN_CHATGPT_REQUIRED));
            }
        }
        let (work, title_work) = {
            let mut inner = self.lock()?;
            let session_id = inner.settings.active_session_id.clone();
            if inner.active_chat_responses.contains_key(&session_id) {
                return Err(anyhow!(ERR_VALIDATION_STOP_FIRST));
            }
            inner.save_active_session_model_settings()?;
            let (_, model) = crate::domain::split_model_key(&inner.settings.model)
                .ok_or_else(|| anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST))?;
            let model = model.to_owned();
            let thinking_variant = inner
                .catalog
                .normalize_thinking_variant(&inner.settings.thinking_variant, &model);
            let verbosity = inner
                .catalog
                .resolve_verbosity(&inner.settings.verbosity, &model);
            inner.settings.thinking_variant = thinking_variant.clone();
            inner.settings.verbosity = inner
                .catalog
                .normalize_verbosity(&inner.settings.verbosity, &model);
            let title_gen_model = inner.settings.title_gen_model.clone();
            let session = inner.active_session_mut()?;
            let user_message = ChatMessage::user(text.clone(), image_data_urls);
            let should_generate_title =
                session.title == CHAT_DEFAULT_TITLE && session.messages.is_empty();
            let title_work = if should_generate_title
                && !title_gen_model.trim().eq_ignore_ascii_case(LABEL_NONE)
            {
                Some(PendingCodexTitleResponse {
                    session_id: session_id.clone(),
                    fallback_title: fallback_session_title(&user_message),
                    request: codex_title_request(
                        &user_message,
                        model.clone(),
                        thinking_variant.clone(),
                    ),
                })
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
            let messages = build_codex_context_messages(session);
            let work = PendingCodexChatResponse {
                session_id,
                assistant_message_id,
                request: chatgpt::ChatRequest {
                    messages,
                    model,
                    thinking_variant,
                    response_style: verbosity,
                },
            };
            inner.status = STATUS_GENERATING_ANSWER.to_owned();
            inner.storage.save_sessions(&inner.sessions)?;
            inner.storage.save_settings(&inner.settings)?;
            (work, title_work)
        };
        let state_clone = self.clone();
        let work_clone = work.clone();
        let app_clone = app_handle.clone();
        chat_pipeline::spawn_chat_stream(
            self,
            work.session_id.clone(),
            work.assistant_message_id.clone(),
            app_handle.clone(),
            async move {
                state_clone
                    .execute_codex_chat_response(work_clone, app_clone)
                    .await
            },
        );
        if let Some(title_work) = title_work {
            let state_clone = self.clone();
            chat_pipeline::spawn_title_stream(self, app_handle, async move {
                state_clone.execute_codex_title_response(title_work).await
            });
        }
        self.snapshot()
    }

    /// Requests a Codex generated title and stores it when the chat still exists.
    async fn execute_codex_title_response(
        &self,
        work: PendingCodexTitleResponse,
    ) -> Result<(String, String)> {
        let access = self.codex_access_context().await?;
        let raw = chatgpt::stream_chat_response(&access, work.request, |_| {}).await?;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        self.save_generated_session_title(&work.session_id, &title)?;
        Ok((work.session_id, title))
    }

    /// Streams a Codex answer and persists it.
    async fn execute_codex_chat_response(
        &self,
        work: PendingCodexChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let access = self.codex_access_context().await?;
        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();
        let final_answer = chatgpt::stream_chat_response(&access, work.request, move |partial| {
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
}

/// Builds Codex request messages from the active session context.
fn build_codex_context_messages(
    session: &crate::domain::ChatSession,
) -> Vec<chatgpt::ChatRequestMessage> {
    let messages: Vec<_> = session
        .messages
        .iter()
        .filter(|m| m.has_content())
        .collect();
    let start = messages.len().saturating_sub(MESSAGE_CONTEXT_LIMIT);
    messages[start..]
        .iter()
        .map(|m| chatgpt::ChatRequestMessage {
            role: match m.role {
                ChatRole::User => "user".to_owned(),
                ChatRole::Assistant => "assistant".to_owned(),
            },
            text: m.text.clone(),
            image_data_urls: m.image_data_urls.clone(),
        })
        .collect()
}

/// Builds a hidden Codex title-generation request.
fn codex_title_request(
    message: &ChatMessage,
    model: String,
    thinking_variant: String,
) -> chatgpt::ChatRequest {
    chatgpt::ChatRequest {
        messages: vec![chatgpt::ChatRequestMessage {
            role: "user".to_owned(),
            text: title_prompt(message),
            image_data_urls: message.image_data_urls.clone(),
        }],
        model,
        thinking_variant,
        response_style: TITLE_RESPONSE_STYLE.to_owned(),
    }
}
