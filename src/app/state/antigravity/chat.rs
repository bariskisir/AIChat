//! Antigravity chat submission and title generation.

use crate::app::state::AppState;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use crate::domain::messages::*;
use crate::domain::{
    ANTIGRAVITY_PROVIDER_URL, ChatMessage, ChatRole, MESSAGE_CONTEXT_LIMIT,
    fallback_session_title, sanitize_session_title, split_model_key,
};
use crate::infra::antigravity::{AntigravityChatRequest, AntigravityMessage, stream_chat_response};
use anyhow::{Result, anyhow};
use tauri::AppHandle;

use crate::app::state::chat_pipeline;
use crate::infra::antigravity;

struct PendingAntigravityChatResponse {
    session_id: String,
    assistant_message_id: String,
    request: AntigravityChatRequest,
}

struct PendingAntigravityTitleResponse {
    session_id: String,
    fallback_title: String,
    request: AntigravityChatRequest,
}

impl AppState {
    /// Queues a user message to the antigravity provider and starts streaming.
    pub(in crate::app::state) fn send_antigravity_message(
        &self,
        input: SendMessageRequest,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        {
            let inner = self.lock()?;
            let provider = inner
                .providers
                .providers
                .iter()
                .find(|p| p.api_url.trim() == ANTIGRAVITY_PROVIDER_URL)
                .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?;
            let has_api_key = !provider.api_key.trim().is_empty();
            let has_credentials = antigravity::credentials_available();
            if (!has_api_key && !has_credentials) || inner.antigravity.project_id.is_empty() {
                return Err(anyhow!(AUTH_ANTIGRAVITY_REQUIRED));
            }
        }
        let (chat_work, title_work) =
            self.prepare_antigravity_chat_work(input)?;
        let (chat_state, chat_app_handle) = (self.clone(), app_handle.clone());
        chat_pipeline::spawn_chat_stream(
            self,
            chat_work.session_id.clone(),
            chat_work.assistant_message_id.clone(),
            chat_app_handle.clone(),
            async move {
                chat_state
                    .execute_antigravity_chat_response(chat_work, chat_app_handle)
                    .await
            },
        );
        if let Some(title_work) = title_work {
            let title_state = self.clone();
            chat_pipeline::spawn_title_stream(self, app_handle, async move {
                title_state
                    .execute_antigravity_title_response(title_work)
                    .await
            });
        }
        self.snapshot()
    }

    /// Locks state, validates readiness, and builds the chat items.
    fn prepare_antigravity_chat_work(
        &self,
        input: SendMessageRequest,
    ) -> Result<(PendingAntigravityChatResponse, Option<PendingAntigravityTitleResponse>)> {
        let text = input.text.trim().to_owned();
        let image_data_urls = input.image_data_urls;
        let mut inner = self.lock()?;
        let session_id = inner.settings.active_session_id.clone();
        if inner.active_chat_responses.contains_key(&session_id) {
            return Err(anyhow!(ERR_VALIDATION_STOP_FIRST));
        }
        inner.save_active_session_model_settings()?;
        let model_key = inner.settings.model.clone();
        let (_, selected_model) = split_model_key(&model_key)
            .ok_or_else(|| anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST))?;
        let session = inner.active_session_mut()?;
        let user_message = ChatMessage::user(text.clone(), image_data_urls.clone());
        let should_generate_title =
            session.title == CHAT_DEFAULT_TITLE && session.messages.is_empty();
        let title_work = if should_generate_title {
            Some(self.build_antigravity_title_work(
                &session_id,
                &user_message,
                selected_model,
            ))
        } else {
            None
        };
        let assistant_message = ChatMessage::assistant_placeholder();
        if session.title == CHAT_DEFAULT_TITLE {
            session.title = fallback_session_title(&user_message);
        }
        session.updated_at = chrono::Utc::now();
        session.messages.push(user_message);
        let assistant_message_id = assistant_message.id.clone();
        session.messages.push(assistant_message);
        let messages = build_antigravity_context_messages(session);
        let chat_work = PendingAntigravityChatResponse {
            session_id,
            assistant_message_id,
            request: AntigravityChatRequest {
                model: selected_model.to_owned(),
                messages,
                request_type: "checkpoint".to_owned(),
            },
        };
        inner.settings.model = model_key;
        inner.status = STATUS_GENERATING_ANSWER.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok((chat_work, title_work))
    }

    /// Builds a title-generation work item for the antigravity provider.
    fn build_antigravity_title_work(
        &self,
        session_id: &str,
        user_message: &ChatMessage,
        model: &str,
    ) -> PendingAntigravityTitleResponse {
        let fallback_title = fallback_session_title(user_message);
        let prompt_text = crate::app::state::chat::title_prompt(user_message);
        PendingAntigravityTitleResponse {
            session_id: session_id.to_owned(),
            fallback_title,
            request: AntigravityChatRequest {
                model: model.to_owned(),
                messages: vec![AntigravityMessage {
                    role: "user".to_owned(),
                    text: prompt_text,
                    image_data_urls: Vec::new(),
                }],
                request_type: "checkpoint".to_owned(),
            },
        }
    }

    /// Streams the antigravity title generation and stores the result.
    async fn execute_antigravity_title_response(
        &self,
        work: PendingAntigravityTitleResponse,
    ) -> Result<(String, String)> {
        self.ensure_antigravity_token_fresh().await?;
        let ctx = self.antigravity_context()?;
        let raw = stream_chat_response(&ctx, work.request, |_| {}).await?;
        let title = sanitize_session_title(&raw).unwrap_or(work.fallback_title);
        self.save_generated_session_title(&work.session_id, &title)?;
        Ok((work.session_id, title))
    }

    /// Ensures the antigravity token is fresh before streaming.
    async fn ensure_antigravity_token_fresh(&self) -> Result<()> {
        let (api_key, mut auth) = {
            let inner = self.lock()?;
            let provider = inner
                .providers
                .providers
                .iter()
                .find(|p| p.api_url.trim() == ANTIGRAVITY_PROVIDER_URL);
            let key = provider.map(|p| p.api_key.trim().to_owned()).unwrap_or_default();
            (key, antigravity::read_credentials())
        };
        match auth {
            Ok(ref mut cred) if !cred.refresh_token.is_empty() && antigravity::auth_expired(cred) => {
                let refreshed = antigravity::refresh_access_token(&cred.refresh_token).await?;
                let _ = antigravity::write_credentials(&refreshed);
                *cred = refreshed;
            }
            Err(_) if !api_key.is_empty() => {} // Using api_key fallback, no refresh needed
            _ => {}
        }
        Ok(())
    }

    /// Streams the antigravity chat response and persists the final answer.
    async fn execute_antigravity_chat_response(
        &self,
        work: PendingAntigravityChatResponse,
        app_handle: AppHandle,
    ) -> Result<AppSnapshot> {
        self.ensure_antigravity_token_fresh().await?;
        let ctx = self.antigravity_context()?;
        let sid = work.session_id.clone();
        let mid = work.assistant_message_id.clone();
        let stream_state = self.clone();
        let final_answer = stream_chat_response(&ctx, work.request, move |partial| {
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

/// Converts session messages to antigravity format.
fn build_antigravity_context_messages(
    session: &crate::domain::ChatSession,
) -> Vec<AntigravityMessage> {
    let messages: Vec<_> = session
        .messages
        .iter()
        .filter(|m| m.has_content() && m.text.trim() != "[Image attached]")
        .collect();
    let start = messages.len().saturating_sub(MESSAGE_CONTEXT_LIMIT);
    messages[start..]
        .iter()
        .map(|m| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "model",
            };
            AntigravityMessage {
                role: role.to_owned(),
                text: m.text.clone(),
                image_data_urls: m.image_data_urls.clone(),
            }
        })
        .collect()
}
