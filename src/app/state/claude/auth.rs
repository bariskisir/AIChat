//! Claude.ai browser login helpers for shared application state.

use super::super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::AppSnapshot;
use crate::domain::{CLAUDE_PROVIDER_URL, ClaudeCredential, ProviderConfig, model_key};
use crate::domain::messages::*;
use crate::infra::extractor::{BrowserExtractor, LoginResult};
use anyhow::{Result, anyhow};
use tauri::{AppHandle, Emitter};

impl AppState {
    /// Starts the browser-based Claude.ai sign-in flow.
    pub fn start_claude_login(&self, app_handle: AppHandle) -> Result<AppSnapshot> {
        {
            let mut inner = self.lock()?;
            inner.status = STATUS_LAUNCHING_CHROME_LOGIN.to_owned();
        }
        let state = self.clone();
        let handle = app_handle.clone();
        self.runtime.spawn(async move {
            let result = state.complete_claude_login().await;
            match result {
                Ok(snapshot) => {
                    let _ = handle.emit(
                        "app-event",
                        UiEvent::Snapshot {
                            snapshot: Box::new(snapshot),
                        },
                    );
                }
                Err(error) => {
                    state.set_claude_auth_error(&error.to_string());
                    let _ = handle.emit(
                        "app-event",
                        UiEvent::Error {
                            message: error.to_string(),
                        },
                    );
                    if let Ok(snapshot) = state.snapshot() {
                        let _ = handle.emit(
                            "app-event",
                            UiEvent::Snapshot {
                                snapshot: Box::new(snapshot),
                            },
                        );
                    }
                }
            }
        });
        self.snapshot()
    }

    /// Clears Claude authentication and disables the saved Claude provider.
    pub fn sign_out_claude(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.claude_auth = ClaudeCredential::default();
        if let Some(provider) = inner
            .providers
            .providers
            .iter_mut()
            .find(|provider| provider.api_url.eq_ignore_ascii_case(CLAUDE_PROVIDER_URL))
        {
            provider.enabled = false;
            provider.error = AUTH_SIGNED_OUT_CLAUDE.to_owned();
        }
        inner.ensure_selected_model();
        inner.save_active_session_model_settings()?;
        inner.status = AUTH_SIGNED_OUT_CLAUDE.to_owned();
        inner.storage.save_claude_auth(&inner.claude_auth)?;
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Builds a Claude API context from stored credentials.
    pub(super) fn claude_context(&self) -> Result<crate::infra::claude::ClaudeContext> {
        let inner = self.lock()?;
        if !inner.claude_auth.is_signed_in() {
            return Err(anyhow!(AUTH_CONNECT_CLAUDE_REQUIRED));
        }
        Ok(crate::infra::claude::ClaudeContext::from_credential(
            &inner.claude_auth,
        ))
    }

    /// Completes browser login and saves the Claude provider catalog.
    async fn complete_claude_login(&self) -> Result<AppSnapshot> {
        self.set_status(STATUS_LAUNCHING_CHROME_LOGIN);
        let mut extractor = BrowserExtractor::new()?;
        extractor.launch()?;
        self.set_status(STATUS_WAITING_CLAUDE_LOGIN);
        let result = extractor.extract().await?;
        self.store_claude_login_result(result)
    }

    /// Stores Claude browser credentials and upserts the dedicated provider.
    fn store_claude_login_result(&self, result: LoginResult) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.claude_auth = result.credential;
        let existing_id = inner
            .providers
            .providers
            .iter()
            .find(|provider| provider.api_url.eq_ignore_ascii_case(CLAUDE_PROVIDER_URL))
            .map(|provider| provider.id.clone())
            .unwrap_or_default();
        let is_new_provider = existing_id.is_empty();
        let provider_config = claude_provider_from_models(&existing_id, result.models);
        let provider_id = inner.providers.upsert(provider_config);
        if let Some(provider) = inner.providers.provider_mut(&provider_id) {
            for model in &mut provider.models {
                model.provider_id = provider_id.clone();
                model.provider_name = provider.name.clone();
            }
        }
        if is_new_provider
            && let Some(default_model) = inner
                .providers
                .provider(&provider_id)
                .and_then(|provider| provider.models.iter().find(|model| !model.hidden))
        {
            inner.settings.model = model_key(&provider_id, &default_model.model);
            inner.save_active_session_model_settings()?;
        } else {
            inner.ensure_selected_model();
        }
        inner.status = AUTH_CONNECTED_CLAUDE.to_owned();
        inner.storage.save_claude_auth(&inner.claude_auth)?;
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Records a Claude authentication error in shared state.
    fn set_claude_auth_error(&self, message: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.claude_auth.error = message.to_owned();
            inner.status = format!("Claude sign-in failed: {message}");
            let _ = inner.storage.save_claude_auth(&inner.claude_auth);
        }
    }
}

/// Builds the saved provider record for the dedicated Claude backend.
fn claude_provider_from_models(
    id: &str,
    mut models: Vec<crate::domain::AvailableModel>,
) -> ProviderConfig {
    for model in &mut models {
        model.provider_id = id.to_owned();
        model.provider_name = PROVIDER_CLAUDE_NAME.to_owned();
    }
    ProviderConfig {
        id: id.to_owned(),
        name: PROVIDER_CLAUDE_NAME.to_owned(),
        api_url: CLAUDE_PROVIDER_URL.to_owned(),
        api_key: String::new(),
        custom_headers: Vec::new(),
        built_in: false,
        enabled: true,
        models,
        error: String::new(),
    }
}
