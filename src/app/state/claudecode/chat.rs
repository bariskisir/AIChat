//! Claude Code chat submission and streaming state helpers.

use super::super::AppState;
use super::super::chat_pipeline;
use crate::app::state::chat::title_prompt;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::messages::*;
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, fallback_session_title, sanitize_session_title,
};
use crate::infra::claudecode::{self, ClaudeCodeChatRequest, ClaudeCodeMessage};
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::AppHandle;

#[derive(Clone)]
struct PendingClaudeCodeChatResponse {
    session_id: String,
    assistant_message_id: String,
    request: ClaudeCodeChatRequest,
}

#[derive(Clone)]
struct PendingClaudeCodeTitleResponse {
    session_id: String,
    fallback_title: String,
    request: ClaudeCodeChatRequest,
}

impl AppState {
    /// Queues a user message for the Claude Code (Anthropic API) backend.
    pub(in crate::app::state) fn send_claude_code_message(
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
        if !claudecode::credentials_available() {
            return Err(anyhow!(AUTH_CLAUDE_CODE_REQUIRED));
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
            let effort = {
                let all_models = inner.providers.all_models();
                resolve_effort(&inner.settings.claude_effort, &model, &all_models)
            };
            let title_gen_model = inner.settings.title_gen_model.clone();
            let session = inner.active_session_mut()?;
            let user_message = ChatMessage::user(text.clone(), image_data_urls.clone());
            let should_generate_title =
                session.title == CHAT_DEFAULT_TITLE && session.messages.is_empty();
            let title_work = if should_generate_title
                && !title_gen_model.trim().eq_ignore_ascii_case(LABEL_NONE)
            {
                Some(PendingClaudeCodeTitleResponse {
                    session_id: session_id.clone(),
                    fallback_title: fallback_session_title(&user_message),
                    request: ClaudeCodeChatRequest {
                        model: model.clone(),
                        messages: vec![ClaudeCodeMessage {
                            role: "user".to_owned(),
                            text: title_prompt(&user_message),
                            image_data_urls: Vec::new(),
                        }],
                        effort: resolve_title_effort(&effort),
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
            let messages = build_claude_code_context_messages(session);
            let work = PendingClaudeCodeChatResponse {
                session_id,
                assistant_message_id,
                request: ClaudeCodeChatRequest {
                    model,
                    messages,
                    effort,
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
                    .execute_claude_code_chat_response(work_clone, app_clone)
                    .await
            },
        );
        if let Some(title_work) = title_work {
            let state_clone = self.clone();
            chat_pipeline::spawn_title_stream(self, app_handle, async move {
                state_clone
                    .execute_claude_code_title_response(title_work)
                    .await
            });
        }
        self.snapshot()
    }

    /// Requests a Claude Code generated title and stores it when the chat still exists.
    async fn execute_claude_code_title_response(
        &self,
        work: PendingClaudeCodeTitleResponse,
    ) -> Result<(String, String)> {
        let ctx = self.claude_code_context()?;
        let raw = claudecode::stream_chat_response(&ctx, work.request, |_| {}).await?;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        self.save_generated_session_title(&work.session_id, &title)?;
        Ok((work.session_id, title))
    }

    /// Streams a Claude Code answer and persists it.
    async fn execute_claude_code_chat_response(
        &self,
        work: PendingClaudeCodeChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let ctx = self.claude_code_context()?;
        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();
        let final_answer =
            claudecode::stream_chat_response(&ctx, work.request, move |partial| {
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

/// Builds Claude Code request messages from the active session context.
fn build_claude_code_context_messages(
    session: &crate::domain::ChatSession,
) -> Vec<ClaudeCodeMessage> {
    let messages: Vec<_> = session
        .messages
        .iter()
        .filter(|m| m.has_content())
        .collect();
    let start = messages.len().saturating_sub(MESSAGE_CONTEXT_LIMIT);
    messages[start..]
        .iter()
        .map(|m| ClaudeCodeMessage {
            role: match m.role {
                ChatRole::User => "user".to_owned(),
                ChatRole::Assistant => "assistant".to_owned(),
            },
            text: m.text.clone(),
            image_data_urls: m.image_data_urls.clone(),
        })
        .collect()
}

/// Resolves the effort value for a model, returning `None` when effort is unsupported.
fn resolve_effort(value: &str, model: &str, all_models: &[crate::domain::AvailableModel]) -> Option<String> {
    let entry = all_models.iter().find(|m| m.model == model)?;
    if entry.claude_thinking_type != "effort_and_mode" || entry.thinking_variants.is_empty() {
        return None;
    }
    if entry.thinking_variants.iter().any(|variant| variant.value == value) {
        return Some(value.to_owned());
    }
    if !entry.default_thinking_variant.is_empty() {
        return Some(entry.default_thinking_variant.clone());
    }
    entry
        .thinking_variants
        .last()
        .map(|variant| variant.value.clone())
}

/// Picks a lighter effort for title generation while honoring model support.
fn resolve_title_effort(chat_effort: &Option<String>) -> Option<String> {
    chat_effort.as_ref().map(|_| LABEL_THINKING_LOW.to_owned())
}
