//! Chat message submission, streaming, and title generation for Claude.

use super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, fallback_session_title, sanitize_session_title,
};
use crate::infra::claude;
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tokio::task::AbortHandle;

#[derive(Clone)]
pub(in crate::app) struct ActiveChatResponse {
    pub(super) session_id: String,
    pub(super) assistant_message_id: String,
    pub(super) abort_handle: AbortHandle,
}

#[derive(Clone)]
struct PendingChatResponse {
    session_id: String,
    assistant_message_id: String,
    conv_id: String,
    request: claude::ClaudeChatRequest,
}

#[derive(Clone)]
struct PendingTitleResponse {
    session_id: String,
    fallback_title: String,
    request: claude::ClaudeChatRequest,
    conv_id: String,
}

impl AppState {
    /// Queues a user message, starts Claude streaming, and returns the updated snapshot.
    pub fn send_message(
        &self,
        input: SendMessageRequest,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let text = input.text.trim().to_owned();
        let image_data_urls = input.image_data_urls;
        if text.is_empty() && image_data_urls.is_empty() {
            return Err(anyhow!("Enter a message or paste an image first."));
        }
        self.ensure_signed_in()?;

        let (work, title_work) = {
            let mut inner = self.lock()?;
            let session_id = inner.settings.active_session_id.clone();
            if inner.active_chat_responses.contains_key(&session_id) {
                return Err(anyhow!(
                    "Stop the current answer before sending another message."
                ));
            }
            inner.save_active_session_model_settings()?;
            let model = inner.settings.model.clone();
            let session = inner.active_session_mut()?;
            let ext_thinking = session.extended_thinking;
            let conv_id = uuid_v4();

            let user_message = ChatMessage::user(text.clone(), image_data_urls.clone());
            let should_generate_title = session.title == "New chat" && session.messages.is_empty();
            let title_work = if should_generate_title {
                Some(PendingTitleResponse {
                    session_id: session_id.clone(),
                    fallback_title: fallback_session_title(&user_message),
                    request: claude::ClaudeChatRequest {
                        prompt: title_prompt(&user_message),
                        model: model.clone(),
                        extended_thinking: false,
                        image_data_urls: Vec::new(),
                    },
                    conv_id: uuid_v4(),
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

            let prompt_text = build_context_prompt(session);
            let work = PendingChatResponse {
                session_id,
                assistant_message_id,
                conv_id,
                request: claude::ClaudeChatRequest {
                    prompt: prompt_text,
                    model,
                    extended_thinking: ext_thinking,
                    image_data_urls,
                },
            };
            inner.status = "Generating answer...".to_owned();
            inner.storage.save_sessions(&inner.sessions)?;
            inner.storage.save_settings(&inner.settings)?;
            (work, title_work)
        };

        self.spawn_chat_response(work, app_handle.clone());
        if let Some(title_work) = title_work {
            self.spawn_title_response(title_work, app_handle);
        }
        self.snapshot()
    }

    /// Stops an active Claude response and removes an empty assistant placeholder.
    pub fn stop_chat_response(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        let Some(active) = inner.active_chat_responses.remove(session_id) else {
            inner.status = "No answer is running.".to_owned();
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
        inner.status = "Answer stopped.".to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Spawns the background task that streams a Claude answer into app state.
    fn spawn_chat_response(&self, work: PendingChatResponse, app_handle: AppHandle) {
        let state = self.clone();
        let active_session_id = work.session_id.clone();
        let active = ActiveChatResponse {
            session_id: work.session_id.clone(),
            assistant_message_id: work.assistant_message_id.clone(),
            abort_handle: self
                .runtime
                .spawn(async move {
                    let result = state
                        .execute_chat_response(work.clone(), app_handle.clone())
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
                            state.finish_failed_chat_response(&work);
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

    /// Spawns the background task that generates a short session title.
    fn spawn_title_response(&self, work: PendingTitleResponse, app_handle: AppHandle) {
        let state = self.clone();
        self.runtime.spawn(async move {
            if let Ok((sid, title)) = state.execute_title_response(work).await {
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

    /// Requests a Claude-generated title and stores it when the chat still exists.
    async fn execute_title_response(&self, work: PendingTitleResponse) -> Result<(String, String)> {
        let ctx = self.claude_context()?;
        if !claude::create_conversation(&ctx, &work.conv_id, &work.request.model).await? {
            return Ok((work.session_id, work.fallback_title));
        }
        let raw = claude::stream_chat_response(&ctx, &work.conv_id, work.request, |_| {}).await?;
        let _ = claude::delete_conversation(&ctx, &work.conv_id).await;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        let mut inner = self.lock()?;
        if let Ok(session) = inner.session_mut(&work.session_id) {
            if !session.messages.is_empty() {
                session.title = title.clone();
                session.updated_at = Utc::now();
                inner.storage.save_sessions(&inner.sessions)?;
            }
        }
        Ok((work.session_id, title))
    }

    /// Creates a Claude conversation, streams the final answer, and persists it.
    async fn execute_chat_response(
        &self,
        work: PendingChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let ctx = self.claude_context()?;

        // Create conversation
        if !claude::create_conversation(&ctx, &work.conv_id, &work.request.model).await? {
            return Err(anyhow!("Failed to create Claude conversation."));
        }

        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();

        let final_answer =
            claude::stream_chat_response(&ctx, &work.conv_id, work.request, |partial| {
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

    /// Appends one streamed text delta to the assistant message in memory.
    fn append_streamed_text(&self, session_id: &str, message_id: &str, text: &str) {
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

    /// Cleans up placeholders and running-state bookkeeping after a failed stream.
    fn finish_failed_chat_response(&self, work: &PendingChatResponse) {
        if let Ok(mut inner) = self.lock() {
            if inner
                .active_chat_responses
                .get(&work.session_id)
                .is_some_and(|a| a.assistant_message_id == work.assistant_message_id)
            {
                inner.active_chat_responses.remove(&work.session_id);
                if let Ok(session) = inner.session_mut(&work.session_id) {
                    if let Some(index) = session
                        .messages
                        .iter()
                        .position(|m| m.id == work.assistant_message_id)
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

/// Builds a prompt from session messages for Claude context.
fn build_context_prompt(session: &crate::domain::ChatSession) -> String {
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

/// Builds a title-generation prompt.
fn title_prompt(message: &ChatMessage) -> String {
    let text = if message.text.trim().is_empty() {
        "Image-only first message.".to_string()
    } else {
        message.text.trim().chars().take(2000).collect::<String>()
    };
    format!(
        "Generate a concise chat title in the same language as the user's first message. \
         Return only the title, no quotation marks, no markdown, maximum 6 words.\n\n\
         User's first message:\n{text}"
    )
}

/// Generates a UUID v4 string for Claude conversation and message identifiers.
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
