//! Claude.ai credential management via browser-based login.
//! Also fetches available models and user info from claude.ai during login.

use super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::AppSnapshot;
use crate::domain::ClaudeCredential;
use crate::infra::extractor::BrowserExtractor;
use anyhow::{Result, anyhow};
use tauri::{AppHandle, Emitter};

impl AppState {
    /// Starts login and emits async status snapshots to the frontend.
    pub fn start_login(&self, app_handle: AppHandle) -> Result<AppSnapshot> {
        // Show immediate status before async work
        {
            let mut inner = self.lock()?;
            inner.status = "Launching Chrome...".to_owned();
        }

        let state = self.clone();
        let handle = app_handle.clone();

        // Emit snapshot so frontend shows "Launching Chrome..."
        if let Ok(snapshot) = self.snapshot() {
            let _ = handle.emit(
                "app-event",
                UiEvent::Snapshot {
                    snapshot: Box::new(snapshot),
                },
            );
        }

        self.runtime.spawn(async move {
            let result = state.do_browser_login().await;
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
                    // Also emit a snapshot so frontend gets updated state
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

    /// Runs the Chrome login flow and stores the resulting Claude credentials.
    async fn do_browser_login(&self) -> Result<AppSnapshot> {
        let status = self.clone();
        status.set_status("Launching Chrome for Claude login...");

        let mut extractor = BrowserExtractor::new().map_err(|e| anyhow!("{e}"))?;

        extractor.launch().map_err(|e| anyhow!("{e}"))?;

        status.set_status("Waiting for you to log into Claude...");

        let result = extractor.extract().await.map_err(|e| anyhow!("{e}"))?;

        let mut inner = self.lock()?;
        inner.auth = result.credential;
        inner.catalog.set_models(result.models);
        inner.ensure_selected_model();
        inner.save_active_session_model_settings()?;
        inner.status = "Connected to Claude.".to_owned();
        inner.storage.save_auth(&inner.auth)?;
        inner.storage.save_catalog(&inner.catalog)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Clears the stored Claude account.
    pub fn sign_out(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.auth = ClaudeCredential::default();
        inner.storage.save_auth(&inner.auth)?;
        inner.status = "Signed out.".to_owned();
        Ok(inner.build_snapshot())
    }

    /// Builds a Claude API context from stored credentials.
    pub(super) fn claude_context(&self) -> Result<crate::infra::claude::ClaudeContext> {
        let inner = self.lock()?;
        if !inner.auth.is_signed_in() {
            return Err(anyhow!("Connect to Claude first."));
        }
        Ok(crate::infra::claude::ClaudeContext::from_credential(
            &inner.auth,
        ))
    }

    /// Ensures commands that require Claude auth have a session.
    pub(super) fn ensure_signed_in(&self) -> Result<()> {
        let inner = self.lock()?;
        if inner.auth.is_signed_in() {
            Ok(())
        } else {
            Err(anyhow!("Connect to Claude first."))
        }
    }

    /// Stores a login error in auth state for display.
    fn set_auth_error(&self, message: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.auth.error = message.to_owned();
            inner.status = message.to_owned();
            let _ = inner.storage.save_auth(&inner.auth);
        }
    }
}
