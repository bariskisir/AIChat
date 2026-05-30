//! Claude chat submission and streaming state helpers.

use super::super::chat_pipeline;
use super::super::AppState;
use crate::app::state::chat::title_prompt;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, fallback_session_title, sanitize_session_title,
};
use crate::domain::messages::*;
use crate::infra::claude;
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::AppHandle;

#[derive(Clone)]
struct PendingClaudeChatResponse {
    session_id: String,
    assistant_message_id: String,
    conv_id: String,
    request: claude::ClaudeChatRequest,
}

#[derive(Clone)]
struct PendingClaudeTitleResponse {
    session_id: String,
    fallback_title: String,
    conv_id: String,
    request: claude::ClaudeChatRequest,
}

impl AppState {
    /// Queues a user message for the Claude.ai backend.
    pub(in crate::app::state) fn send_claude_message(
        &self,
        input: SendMessageRequest,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let text = input.text.trim().to_owned();
        let image_data_urls = input.image_data_urls.clone();
        {
            let inner = self.lock()?;
            if !inner.claude_auth.is_signed_in() {
                return Err(anyhow!(AUTH_CONNECT_CLAUDE_REQUIRED));
            }
        }
        let (work, title_work) = {
            let mut inner = self.lock()?;
            let session_id = inner.settings.active_session_id.clone();
            if inner.active_chat_responses.contains_key(&session_id) {
                return Err(anyhow!(
                    ERR_VALIDATION_STOP_FIRST
                ));
            }
            inner.save_active_session_model_settings()?;
            let (_, model) = crate::domain::split_model_key(&inner.settings.model)
                .ok_or_else(|| anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST))?;
            let model = model.to_owned();
            let extended_thinking = inner.settings.extended_thinking;
            let effort = claude_effort_for_model(&inner.settings.claude_effort, &model);
            let title_gen_model = inner.settings.title_gen_model.clone();
            let session = inner.active_session_mut()?;
            let conv_id = uuid::Uuid::new_v4().to_string();
            let user_message = ChatMessage::user(text.clone(), image_data_urls.clone());
            let should_generate_title = session.title == CHAT_DEFAULT_TITLE && session.messages.is_empty();
            let title_work =
                if should_generate_title && !title_gen_model.trim().eq_ignore_ascii_case("none") {
                    Some(PendingClaudeTitleResponse {
                        session_id: session_id.clone(),
                        fallback_title: fallback_session_title(&user_message),
                        conv_id: uuid::Uuid::new_v4().to_string(),
                        request: claude::ClaudeChatRequest {
                            prompt: title_prompt(&user_message),
                            model: model.clone(),
                            extended_thinking: false,
                            effort: None,
                            image_data_urls: Vec::new(),
                        },
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
            let prompt = build_claude_context_prompt(session);
            let work = PendingClaudeChatResponse {
                session_id,
                assistant_message_id,
                conv_id,
                request: claude::ClaudeChatRequest {
                    prompt,
                    model,
                    extended_thinking,
                    effort,
                    image_data_urls,
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
            async move { state_clone.execute_claude_chat_response(work_clone, app_clone).await },
        );
        if let Some(title_work) = title_work {
            let state_clone = self.clone();
            chat_pipeline::spawn_title_stream(
                self,
                app_handle,
                async move { state_clone.execute_claude_title_response(title_work).await },
            );
        }
        self.snapshot()
    }


    /// Requests a Claude generated title and stores it when the chat still exists.
    async fn execute_claude_title_response(
        &self,
        work: PendingClaudeTitleResponse,
    ) -> Result<(String, String)> {
        let ctx = self.claude_context()?;
        if !claude::create_conversation(&ctx, &work.conv_id, &work.request.model).await? {
            return Ok((work.session_id, work.fallback_title));
        }
        let raw = claude::stream_chat_response(&ctx, &work.conv_id, work.request, |_| {}).await?;
        let _ = claude::delete_conversation(&ctx, &work.conv_id).await;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        self.save_generated_session_title(&work.session_id, &title)?;
        Ok((work.session_id, title))
    }

    /// Streams a Claude answer and persists it.
    async fn execute_claude_chat_response(
        &self,
        work: PendingClaudeChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let ctx = self.claude_context()?;
        if !claude::create_conversation(&ctx, &work.conv_id, &work.request.model).await? {
            return Err(anyhow!(AUTH_FAILED_CREATE_CLAUDE_CONVERSATION));
        }
        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();
        let final_answer =
            claude::stream_chat_response(&ctx, &work.conv_id, work.request, move |partial| {
                stream_state.append_streamed_text(&sid, &mid, &partial);
                Self::emit_assistant_delta_event(&app_handle, &sid, &mid, partial);
            })
            .await?;
        let _ = claude::delete_conversation(&ctx, &work.conv_id).await;
        self.finish_successful_chat_response(
            &work.session_id,
            &work.assistant_message_id,
            final_answer,
        )
    }
}

/// Builds a Claude prompt from the active session context.
fn build_claude_context_prompt(session: &crate::domain::ChatSession) -> String {
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
                ChatRole::User => "Human",
                ChatRole::Assistant => "Assistant",
            };
            let text = if m.text.trim().is_empty() && !m.image_data_urls.is_empty() {
                CHAT_IMAGE_ATTACHED.to_owned()
            } else if !m.image_data_urls.is_empty() {
                format!("{}\n{}", m.text, CHAT_IMAGE_ATTACHED)
            } else {
                m.text.clone()
            };
            format!("{role}: {text}")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Returns a Claude effort value only for non-Haiku models.
fn claude_effort_for_model(value: &str, model: &str) -> Option<String> {
    if model.to_lowercase().contains("haiku") {
        return None;
    }
    match value {
        "low" | "medium" | "high" => Some(value.to_owned()),
        _ => Some("high".to_owned()),
    }
}
