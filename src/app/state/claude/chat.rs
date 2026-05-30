//! Claude chat submission and streaming state helpers.

use super::super::AppState;
use crate::app::events::UiEvent;
use crate::app::state::chat::{ActiveChatResponse, title_prompt};
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, fallback_session_title, sanitize_session_title,
};
use crate::infra::claude;
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter};

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
                return Err(anyhow!("Connect to Claude first."));
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
            let extended_thinking = inner.settings.extended_thinking;
            let effort = claude_effort_for_model(&inner.settings.claude_effort, &model);
            let title_gen_model = inner.settings.title_gen_model.clone();
            let session = inner.active_session_mut()?;
            let conv_id = uuid_v4();
            let user_message = ChatMessage::user(text.clone(), image_data_urls.clone());
            let should_generate_title = session.title == "New chat" && session.messages.is_empty();
            let title_work = if should_generate_title
                && !title_gen_model.trim().eq_ignore_ascii_case("none")
            {
                Some(PendingClaudeTitleResponse {
                    session_id: session_id.clone(),
                    fallback_title: fallback_session_title(&user_message),
                    conv_id: uuid_v4(),
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
            if session.title == "New chat" {
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
            inner.status = "Generating answer...".to_owned();
            inner.storage.save_sessions(&inner.sessions)?;
            inner.storage.save_settings(&inner.settings)?;
            (work, title_work)
        };
        self.spawn_claude_chat_response(work, app_handle.clone());
        if let Some(title_work) = title_work {
            self.spawn_claude_title_response(title_work, app_handle);
        }
        self.snapshot()
    }

    /// Spawns a Claude response stream on the background runtime.
    fn spawn_claude_chat_response(&self, work: PendingClaudeChatResponse, app_handle: AppHandle) {
        let state = self.clone();
        let active_session_id = work.session_id.clone();
        let active = ActiveChatResponse {
            session_id: work.session_id.clone(),
            assistant_message_id: work.assistant_message_id.clone(),
            abort_handle: self
                .runtime
                .spawn(async move {
                    let result = state
                        .execute_claude_chat_response(work.clone(), app_handle.clone())
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

    /// Spawns a hidden Claude title request.
    fn spawn_claude_title_response(&self, work: PendingClaudeTitleResponse, app_handle: AppHandle) {
        let state = self.clone();
        self.runtime.spawn(async move {
            if let Ok((sid, title)) = state.execute_claude_title_response(work).await {
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

    /// Streams a Claude answer and persists it.
    async fn execute_claude_chat_response(
        &self,
        work: PendingClaudeChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let ctx = self.claude_context()?;
        if !claude::create_conversation(&ctx, &work.conv_id, &work.request.model).await? {
            return Err(anyhow!("Failed to create Claude conversation."));
        }
        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();
        let final_answer =
            claude::stream_chat_response(&ctx, &work.conv_id, work.request, move |partial| {
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
        let _ = claude::delete_conversation(&ctx, &work.conv_id).await;
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
                "[Image attached]".to_owned()
            } else if !m.image_data_urls.is_empty() {
                format!("{}\n[Image attached]", m.text)
            } else {
                m.text.clone()
            };
            format!("{role}: {text}")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Generates a UUID v4 string for Claude conversation identifiers.
fn uuid_v4() -> String {
    use rand::Rng;
    let mut bytes = [0u8; 16];
    rand::rng().fill(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
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
