//! Codex ChatGPT OAuth helpers for shared application state.

use super::super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::AppSnapshot;
use crate::domain::{AuthStorage, CODEX_PROVIDER_URL, CatalogStorage, ProviderConfig, model_key};
use crate::domain::messages::*;
use crate::infra::{chatgpt, shell};
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter};

impl AppState {
    /// Starts the ChatGPT OAuth sign-in flow used by the Codex provider.
    pub fn start_codex_login(&self, app_handle: AppHandle) -> Result<AppSnapshot> {
        let (pending, authorization_url) = chatgpt::create_login_request()?;
        {
            let mut inner = self.lock()?;
            inner.auth.pending_oauth = Some(pending.clone());
            inner.auth.error.clear();
            inner.status = STATUS_OPENING_CHATGPT_SIGNIN.to_owned();
            inner.storage.save_auth(&inner.auth)?;
        }
        let state = self.clone();
        let handle = app_handle.clone();
        self.runtime.spawn(async move {
            let result = async {
                let code = chatgpt::wait_for_oauth_callback(pending.state.clone()).await?;
                let auth = chatgpt::exchange_authorization_code(&code, &pending.verifier).await?;
                state.complete_codex_login(auth).await
            }
            .await;
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
                    state.set_codex_auth_error(&error.to_string());
                    let _ = handle.emit(
                        "app-event",
                        UiEvent::Error {
                            message: error.to_string(),
                        },
                    );
                }
            }
        });
        shell::open_url(&authorization_url)?;
        self.snapshot()
    }

    /// Returns a valid ChatGPT access context for Codex requests.
    pub(super) async fn codex_access_context(&self) -> Result<chatgpt::AccessContext> {
        let auth = {
            let inner = self.lock()?;
            inner.auth.clone()
        };
        if !auth.is_signed_in() {
            return Err(anyhow!(AUTH_SIGN_IN_CHATGPT_REQUIRED));
        }
        if !auth.access_token.is_empty()
            && auth.expires_at > Utc::now().timestamp_millis() + 5 * 60 * 1000
        {
            return Ok(chatgpt::AccessContext::from_auth(&auth));
        }
        let refreshed = chatgpt::refresh_access_token(&auth).await?;
        let access = chatgpt::AccessContext::from_auth(&refreshed);
        let mut inner = self.lock()?;
        inner.auth = refreshed;
        inner.storage.save_auth(&inner.auth)?;
        Ok(access)
    }

    /// Clears ChatGPT authentication and disables the saved Codex provider.
    pub fn sign_out_codex(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.auth = AuthStorage::default();
        if let Some(provider) = inner
            .providers
            .providers
            .iter_mut()
            .find(|provider| provider.api_url.eq_ignore_ascii_case(CODEX_PROVIDER_URL))
        {
            provider.enabled = false;
            provider.error = AUTH_SIGNED_OUT_CHATGPT.to_owned();
        }
        inner.ensure_selected_model();
        inner.save_active_session_model_settings()?;
        inner.status = AUTH_SIGNED_OUT_CHATGPT.to_owned();
        inner.storage.save_auth(&inner.auth)?;
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Stores successful ChatGPT authentication and refreshes Codex account data.
    async fn complete_codex_login(&self, auth: AuthStorage) -> Result<AppSnapshot> {
        let access = chatgpt::AccessContext::from_auth(&auth);
        let mut catalog = chatgpt::fetch_model_catalog(&access)
            .await
            .unwrap_or_else(|_| CatalogStorage::default());
        catalog.chatgpt_limit_label = chatgpt::fetch_usage_limit_label(&access)
            .await
            .unwrap_or_default();
        let mut inner = self.lock()?;
        inner.auth = auth;
        inner.catalog = catalog;
        let existing_id = inner
            .providers
            .providers
            .iter()
            .find(|provider| provider.api_url.eq_ignore_ascii_case(CODEX_PROVIDER_URL))
            .map(|provider| provider.id.clone())
            .unwrap_or_default();
        let is_new_provider = existing_id.is_empty();
        let provider_config = codex_provider_from_catalog(&existing_id, &inner.catalog);
        let provider_id = inner.providers.upsert(provider_config);
        if let Some(provider) = inner.providers.provider_mut(&provider_id) {
            for model in &mut provider.models {
                model.provider_id = provider_id.clone();
                model.provider_name = provider.name.clone();
            }
        }
        if is_new_provider
            && let Some(default_model) = inner
                .catalog
                .available_models
                .iter()
                .find(|model| model.is_default)
                .or_else(|| inner.catalog.available_models.first())
        {
            inner.settings.model = model_key(&provider_id, &default_model.model);
            inner.save_active_session_model_settings()?;
        } else {
            inner.ensure_selected_model();
        }
        inner.status = AUTH_SIGNED_IN_CHATGPT.to_owned();
        inner.storage.save_auth(&inner.auth)?;
        inner.storage.save_catalog(&inner.catalog)?;
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Records a Codex authentication error in shared state.
    fn set_codex_auth_error(&self, message: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.auth.error = message.to_owned();
            inner.status = format!("ChatGPT sign-in failed: {message}");
            let _ = inner.storage.save_auth(&inner.auth);
        }
    }
}

/// Builds the saved provider record for the dedicated Codex backend.
fn codex_provider_from_catalog(id: &str, catalog: &CatalogStorage) -> ProviderConfig {
    let mut models = catalog.available_models.clone();
    for model in &mut models {
        model.provider_id = id.to_owned();
        model.provider_name = PROVIDER_CODEX_NAME.to_owned();
    }
    ProviderConfig {
        id: id.to_owned(),
        name: PROVIDER_CODEX_NAME.to_owned(),
        api_url: CODEX_PROVIDER_URL.to_owned(),
        api_key: String::new(),
        custom_headers: Vec::new(),
        built_in: false,
        enabled: true,
        models,
        error: String::new(),
    }
}
