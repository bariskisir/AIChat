//! Codex chat submission and streaming state helpers.

use super::super::AppState;
use crate::app::events::UiEvent;
use crate::app::state::chat::{ActiveChatResponse, title_prompt};
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, TITLE_RESPONSE_STYLE, fallback_session_title,
    sanitize_session_title,
};
use crate::infra::chatgpt;
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter};

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
                return Err(anyhow!("Please sign in with ChatGPT first."));
            }
        }
        let (work, title_work) = {
            let mut inner = self.lock()?;
            let session_id = inner.settings.active_session_id.clone();
            if inner.active_chat_responses.contains_key(&session_id) {
                return Err(anyhow!(
                    "Stop the current answer before sending another message."
                ));
            }
            inner.save_active_session_model_settings()?;
            let (_, model) = crate::domain::split_model_key(&inner.settings.model)
                .ok_or_else(|| anyhow!("Select a provider model first."))?;
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
            let session = inner.active_session_mut()?;
            let user_message = ChatMessage::user(text.clone(), image_data_urls);
            let should_generate_title = session.title == "New chat" && session.messages.is_empty();
            let title_work = if should_generate_title {
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
            if session.title == "New chat" {
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
            inner.status = "Generating answer...".to_owned();
            inner.storage.save_sessions(&inner.sessions)?;
            inner.storage.save_settings(&inner.settings)?;
            (work, title_work)
        };
        self.spawn_codex_chat_response(work, app_handle.clone());
        if let Some(title_work) = title_work {
            self.spawn_codex_title_response(title_work, app_handle);
        }
        self.snapshot()
    }

    /// Spawns a Codex response stream on the background runtime.
    fn spawn_codex_chat_response(&self, work: PendingCodexChatResponse, app_handle: AppHandle) {
        let state = self.clone();
        let active_session_id = work.session_id.clone();
        let active = ActiveChatResponse {
            session_id: work.session_id.clone(),
            assistant_message_id: work.assistant_message_id.clone(),
            abort_handle: self
                .runtime
                .spawn(async move {
                    let result = state
                        .execute_codex_chat_response(work.clone(), app_handle.clone())
                        .await;
                    match result {
                        Ok(snapshot) => {
                            let _ = app_handle.emit(
                                "app-event",
                                UiEvent::Snapshot {
                                    snapshot: Box::new(snapshot),
                                },
                            );
                        }
                        Err(error) => {
                            state.finish_failed_assistant_placeholder(
                                &work.session_id,
                                &work.assistant_message_id,
                            );
                            state.set_status(&format!("Error: {error}"));
                            let _ = app_handle.emit(
                                "app-event",
                                UiEvent::Error {
                                    message: error.to_string(),
                                },
                            );
                            if let Ok(snapshot) = state.snapshot() {
                                let _ = app_handle.emit(
                                    "app-event",
                                    UiEvent::Snapshot {
                                        snapshot: Box::new(snapshot),
                                    },
                                );
                            }
                        }
                    }
                })
                .abort_handle(),
        };
        if let Ok(mut inner) = self.lock() {
            inner
                .active_chat_responses
                .insert(active_session_id, active);
        }
    }

    /// Spawns a hidden Codex title request.
    fn spawn_codex_title_response(&self, work: PendingCodexTitleResponse, app_handle: AppHandle) {
        let state = self.clone();
        self.runtime.spawn(async move {
            if let Ok((sid, title)) = state.execute_codex_title_response(work).await {
                let _ = app_handle.emit(
                    "app-event",
                    UiEvent::SessionTitleUpdated {
                        session_id: sid,
                        title,
                    },
                );
            }
        });
    }

    /// Requests a Codex generated title and stores it when the chat still exists.
    async fn execute_codex_title_response(
        &self,
        work: PendingCodexTitleResponse,
    ) -> Result<(String, String)> {
        let access = self.codex_access_context().await?;
        let raw = chatgpt::stream_chat_response(&access, work.request, |_| {}).await?;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        let mut inner = self.lock()?;
        if let Ok(session) = inner.session_mut(&work.session_id)
            && !session.messages.is_empty()
        {
            session.title = title.clone();
            session.updated_at = Utc::now();
            inner.storage.save_sessions(&inner.sessions)?;
        }
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
            let _ = app_handle.emit(
                "app-event",
                UiEvent::AssistantDelta {
                    session_id: sid.clone(),
                    message_id: mid.clone(),
                    text: partial,
                },
            );
        })
        .await?;
        let mut inner = self.lock()?;
        if let Ok(session) = inner.session_mut(&work.session_id) {
            if let Some(msg) = session
                .messages
                .iter_mut()
                .find(|m| m.id == work.assistant_message_id)
            {
                msg.text = final_answer;
            }
            session.updated_at = Utc::now();
        }
        if inner
            .active_chat_responses
            .get(&work.session_id)
            .is_some_and(|a| a.assistant_message_id == work.assistant_message_id)
        {
            inner.active_chat_responses.remove(&work.session_id);
        }
        inner.status = "Answer ready.".to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
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
