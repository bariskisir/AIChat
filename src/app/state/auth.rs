//! ChatGPT authentication helpers for shared application state.

use super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::AppSnapshot;
use crate::domain::{AuthStorage, CatalogStorage};
use crate::infra::{chatgpt, shell};
use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter};

impl AppState {
    /// Starts the ChatGPT OAuth sign-in flow.
    pub fn start_login(&self, app_handle: AppHandle) -> Result<AppSnapshot> {
        let (pending, authorization_url) = chatgpt::create_login_request()?;
        {
            let mut inner = self.lock()?;
            inner.auth.pending_oauth = Some(pending.clone());
            inner.auth.error.clear();
            inner.status = "Opening ChatGPT sign-in...".to_owned();
            inner.storage.save_auth(&inner.auth)?;
        }
        let state = self.clone();
        let handle = app_handle.clone();
        self.runtime.spawn(async move {
            let result = async {
                let code = chatgpt::wait_for_oauth_callback(pending.state.clone()).await?;
                let auth = chatgpt::exchange_authorization_code(&code, &pending.verifier).await?;
                state.complete_login(auth).await
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
                    state.set_auth_error(&error.to_string());
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

    /// Clears stored ChatGPT authentication state.
    pub fn sign_out(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.auth = AuthStorage::default();
        inner.storage.save_auth(&inner.auth)?;
        inner.status = "Signed out of ChatGPT.".to_owned();
        Ok(inner.build_snapshot())
    }

    /// Returns a valid ChatGPT access context, refreshing tokens when needed.
    pub(super) async fn access_context(&self) -> Result<chatgpt::AccessContext> {
        let auth = {
            let inner = self.lock()?;
            inner.auth.clone()
        };
        if !auth.is_signed_in() {
            return Err(anyhow!("Please sign in with ChatGPT first."));
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

    /// Checks that an auth token or refresh token is available before mutating chat.
    pub(super) fn ensure_signed_in(&self) -> Result<()> {
        let inner = self.lock()?;
        if inner.auth.is_signed_in() {
            Ok(())
        } else {
            Err(anyhow!("Please sign in with ChatGPT first."))
        }
    }

    /// Stores successful ChatGPT authentication and refreshes account data.
    async fn complete_login(&self, auth: AuthStorage) -> Result<AppSnapshot> {
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
        inner.normalize_model_settings();
        inner.status = "Signed in with ChatGPT.".to_owned();
        inner.storage.save_auth(&inner.auth)?;
        inner.storage.save_catalog(&inner.catalog)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Records an authentication error in state and persisted auth storage.
    fn set_auth_error(&self, message: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.auth.error = message.to_owned();
            inner.status = format!("ChatGPT sign-in failed: {message}");
            let _ = inner.storage.save_auth(&inner.auth);
        }
    }
}
