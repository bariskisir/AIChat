//! Chat message submission, streaming, and title generation helpers.

use super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::{
    ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT, TITLE_RESPONSE_STYLE, fallback_session_title,
    sanitize_session_title,
};
use crate::infra::chatgpt;
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
    request: chatgpt::ChatRequest,
}

#[derive(Clone)]
struct PendingTitleResponse {
    session_id: String,
    fallback_title: String,
    request: chatgpt::ChatRequest,
}

impl AppState {
    /// Sends a user message in the active session and starts response streaming.
    pub fn send_message(
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
            inner.normalize_model_settings();
            let model = inner.settings.model.clone();
            let thinking_variant = inner.settings.thinking_variant.clone();
            let verbosity = inner
                .catalog
                .resolve_verbosity(&inner.settings.verbosity, &model);
            inner.save_active_session_model_settings()?;
            let session = inner.active_session_mut()?;
            let user_message = ChatMessage::user(text.clone(), image_data_urls);
            let should_generate_title = session.title == "New chat" && session.messages.is_empty();
            let title_work = if should_generate_title {
                Some(PendingTitleResponse {
                    session_id: session_id.clone(),
                    fallback_title: fallback_session_title(&user_message),
                    request: title_request(&user_message, model.clone(), thinking_variant.clone()),
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
            let request_messages = request_messages(session);
            let work = PendingChatResponse {
                session_id,
                assistant_message_id,
                request: chatgpt::ChatRequest {
                    messages: request_messages,
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
        self.spawn_chat_response(work, app_handle.clone());
        if let Some(title_work) = title_work {
            self.spawn_title_response(title_work, app_handle);
        }
        self.snapshot()
    }

    /// Stops a session's active ChatGPT response and keeps any text received so far.
    pub fn stop_chat_response(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        let Some(active) = inner.active_chat_responses.remove(session_id) else {
            inner.status = "No answer is running in this chat.".to_owned();
            return Ok(inner.build_snapshot());
        };
        active.abort_handle.abort();
        {
            let session = inner.session_mut(&active.session_id)?;
            if let Some(index) = session
                .messages
                .iter()
                .position(|message| message.id == active.assistant_message_id)
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

    /// Runs ChatGPT response generation on the background runtime.
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
                            state.set_status(&format!("Could not generate answer: {error}"));
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

    /// Runs hidden title generation on the background runtime.
    fn spawn_title_response(&self, work: PendingTitleResponse, app_handle: AppHandle) {
        let state = self.clone();
        self.runtime.spawn(async move {
            if let Ok((session_id, title)) = state.execute_title_response(work).await {
                let _ = app_handle.emit(
                    "app-event",
                    UiEvent::SessionTitleUpdated { session_id, title },
                );
            }
        });
    }

    /// Generates and stores a concise title for the first user message.
    async fn execute_title_response(&self, work: PendingTitleResponse) -> Result<(String, String)> {
        let access = self.access_context().await?;
        let raw_title = chatgpt::stream_chat_response(&access, work.request, |_| {}).await?;
        let title = sanitize_session_title(&raw_title).unwrap_or(work.fallback_title);
        let mut inner = self.lock()?;
        let session = inner.session_mut(&work.session_id)?;
        if !session.messages.is_empty() {
            session.title = title.clone();
            session.updated_at = Utc::now();
            inner.storage.save_sessions(&inner.sessions)?;
        }
        Ok((work.session_id, title))
    }

    /// Streams a ChatGPT response and stores the completed assistant message.
    async fn execute_chat_response(
        &self,
        work: PendingChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        let access = self.access_context().await?;
        let session_id = work.session_id.clone();
        let message_id = work.assistant_message_id.clone();
        let stream_state = self.clone();
        let final_answer = chatgpt::stream_chat_response(&access, work.request, |partial| {
            stream_state.append_streamed_assistant_text(&session_id, &message_id, &partial);
            let _ = app_handle.emit(
                "app-event",
                UiEvent::AssistantDelta {
                    session_id: session_id.clone(),
                    message_id: message_id.clone(),
                    text: partial,
                },
            );
        })
        .await?;
        let mut inner = self.lock()?;
        let session = inner.session_mut(&work.session_id)?;
        if let Some(message) = session
            .messages
            .iter_mut()
            .find(|message| message.id == work.assistant_message_id)
        {
            message.text = final_answer;
        }
        session.updated_at = Utc::now();
        if inner
            .active_chat_responses
            .get(&work.session_id)
            .is_some_and(|active| active.assistant_message_id == work.assistant_message_id)
        {
            inner.active_chat_responses.remove(&work.session_id);
        }
        inner.status = "Answer ready.".to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Appends a streamed assistant chunk to the in-memory session copy.
    fn append_streamed_assistant_text(&self, session_id: &str, message_id: &str, text: &str) {
        if text.is_empty() {
            return;
        }
        if let Ok(mut inner) = self.lock()
            && let Ok(session) = inner.session_mut(session_id)
            && let Some(message) = session
                .messages
                .iter_mut()
                .find(|message| message.id == message_id)
        {
            message.text.push_str(text);
            session.updated_at = Utc::now();
        }
    }

    /// Clears active-response state when response generation fails.
    fn finish_failed_chat_response(&self, work: &PendingChatResponse) {
        if let Ok(mut inner) = self.lock() {
            if inner
                .active_chat_responses
                .get(&work.session_id)
                .is_some_and(|active| active.assistant_message_id == work.assistant_message_id)
            {
                inner.active_chat_responses.remove(&work.session_id);
                if let Ok(session) = inner.session_mut(&work.session_id) {
                    if let Some(index) = session
                        .messages
                        .iter()
                        .position(|message| message.id == work.assistant_message_id)
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

/// Builds the API context messages from a session.
fn request_messages(session: &crate::domain::ChatSession) -> Vec<chatgpt::ChatRequestMessage> {
    let messages = session
        .messages
        .iter()
        .filter(|message| message.has_content())
        .collect::<Vec<_>>();
    let start = messages.len().saturating_sub(MESSAGE_CONTEXT_LIMIT);
    messages[start..]
        .iter()
        .map(|message| chatgpt::ChatRequestMessage {
            role: match message.role {
                ChatRole::User => "user".to_owned(),
                ChatRole::Assistant => "assistant".to_owned(),
            },
            text: message.text.clone(),
            image_data_urls: message.image_data_urls.clone(),
        })
        .collect()
}

/// Builds a hidden title-generation request from the first user message.
fn title_request(
    message: &ChatMessage,
    model: String,
    thinking_variant: String,
) -> chatgpt::ChatRequest {
    let text = if message.text.trim().is_empty() {
        "Image-only first message.".to_owned()
    } else {
        message.text.trim().chars().take(2000).collect::<String>()
    };
    let prompt = format!(
        "Generate a concise chat title in the same language as the user's first message. Return only the title, no quotation marks, no markdown, maximum 6 words.\n\nUser's first message:\n{text}"
    );
    chatgpt::ChatRequest {
        messages: vec![chatgpt::ChatRequestMessage {
            role: "user".to_owned(),
            text: prompt,
            image_data_urls: message.image_data_urls.clone(),
        }],
        model,
        thinking_variant,
        response_style: TITLE_RESPONSE_STYLE.to_owned(),
    }
}
