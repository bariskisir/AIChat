//! Antigravity model refresh and bootstrap logic.

use crate::app::state::AppState;
use crate::app::view::AppSnapshot;
use crate::domain::messages::*;
use crate::domain::{ANTIGRAVITY_PROVIDER_URL, AvailableModel, ProviderConfig};
use crate::infra::antigravity::{self, AntigravityAuth, AntigravityContext};
use anyhow::Result;
use tauri::AppHandle;

const DEFAULT_USER_AGENT: &str =
    "antigravity/cli/1.0.14 (aidev_client; os_type=windows; arch=amd64; auth_method=consumer)";

/// Formats a plan tier ID like "free-tier" as "Free".
fn format_antigravity_plan(tier_id: &str) -> String {
    let first = tier_id.split('-').next().unwrap_or(tier_id);
    let mut chars = first.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}

impl AppState {
    /// Resolves the active access token (credential manager or api_key fallback).
    fn resolve_antigravity_auth(&self, api_key: &str) -> Result<AntigravityAuth> {
        if let Ok(auth) = antigravity::read_credentials() {
            return Ok(auth);
        }
        let key = api_key.trim();
        if !key.is_empty() {
            return Ok(AntigravityAuth {
                access_token: key.to_owned(),
                ..Default::default()
            });
        }
        Err(anyhow::anyhow!(AUTH_ANTIGRAVITY_REQUIRED))
    }

    /// Refreshes the token if expired and persists the result.
    async fn ensure_fresh_antigravity_token(&self, auth: &mut AntigravityAuth) -> Result<()> {
        if !antigravity::auth_expired(auth) || auth.refresh_token.is_empty() {
            return Ok(());
        }
        let refreshed = antigravity::refresh_access_token(&auth.refresh_token).await?;
        let _ = antigravity::write_credentials(&refreshed);
        *auth = refreshed;
        Ok(())
    }

    /// Reads the provider's API key and returns an antigravity context.
    pub(in crate::app::state) fn antigravity_context(&self) -> Result<AntigravityContext> {
        let inner = self.lock()?;
        let provider = inner
            .providers
            .providers
            .iter()
            .find(|p| p.api_url.trim() == ANTIGRAVITY_PROVIDER_URL)
            .ok_or_else(|| anyhow::anyhow!(ERR_NOT_FOUND_PROVIDER))?;
        let api_key = provider.api_key.trim().to_owned();
        drop(inner);
        let auth = self.resolve_antigravity_auth(&api_key)?;
        {
            let mut inner = self.lock()?;
            if !auth.email.is_empty() {
                inner.antigravity.email = auth.email.clone();
            }
        }
        let inner = self.lock()?;
        let project_id = inner.antigravity.project_id.clone();
        if project_id.is_empty() {
            return Err(anyhow::anyhow!(AUTH_ANTIGRAVITY_REQUIRED));
        }
        let cli_version = inner.antigravity.cli_version.clone();
        Ok(AntigravityContext::new(
            &auth.access_token,
            &project_id,
            &cli_version,
        ))
    }

    /// Fetches antigravity models and usage from the Google API.
    pub(in crate::app::state) async fn fetch_antigravity_models_for_provider(
        &self,
        provider: &ProviderConfig,
    ) -> Result<Vec<AvailableModel>> {
        let mut auth = self.resolve_antigravity_auth(&provider.api_key)?;
        {
            let mut inner = self.lock()?;
            if !auth.email.is_empty() {
                inner.antigravity.email = auth.email.clone();
            }
        }
        self.ensure_fresh_antigravity_token(&mut auth).await?;
        let (project_id, cli_version) = {
            let need_fetch = {
                let inner = self.lock()?;
                inner.antigravity.project_id.is_empty()
                    || inner.antigravity.cli_version.is_empty()
            };
            if need_fetch {
                let ver = antigravity::fetch_cli_version().await;
                let ua = if ver.is_empty() {
                    DEFAULT_USER_AGENT.to_owned()
                } else {
                    format!("antigravity/cli/{ver} (aidev_client; os_type=windows; arch=amd64; auth_method=consumer)")
                };
                let info = antigravity::fetch_project(&auth.access_token, &ua).await?;
                let mut inner = self.lock()?;
                inner.antigravity.project_id = info.project_id.clone();
                inner.antigravity.cli_version = ver.clone();
                inner.antigravity.plan = format_antigravity_plan(&info.tier_id);
                inner.antigravity.error.clear();
                (info.project_id, ver)
            } else {
                let inner = self.lock()?;
                (
                    inner.antigravity.project_id.clone(),
                    inner.antigravity.cli_version.clone(),
                )
            }
        };
        let ctx = AntigravityContext::new(&auth.access_token, &project_id, &cli_version);
        let mut models = antigravity::fetch_models(&ctx).await?;
        for model in &mut models {
            model.provider_id = provider.id.clone();
            model.provider_name = provider.name.clone();
        }
        let usage = antigravity::fetch_usage(&auth.access_token, &project_id, &ctx.user_agent)
            .await
            .unwrap_or_default();
        let mut inner = self.lock()?;
        inner.antigravity.limit_label = usage;
        inner.antigravity.error.clear();
        Ok(models)
    }

    /// Loads antigravity version + project ID and models in the background at startup.
    pub fn start_antigravity_bootstrap(&self, app_handle: AppHandle) {
        let has_credentials = {
            let inner = match self.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            antigravity::credentials_available()
                || inner
                    .providers
                    .providers
                    .iter()
                    .any(|p| p.api_url.trim() == ANTIGRAVITY_PROVIDER_URL && !p.api_key.trim().is_empty())
        };
        if !has_credentials {
            return;
        }
        let state = self.clone();
        self.runtime.spawn(async move {
            let provider_id = {
                let inner = match state.lock() {
                    Ok(inner) => inner,
                    Err(_) => return,
                };
                inner
                    .providers
                    .providers
                    .iter()
                    .find(|p| p.api_url.trim() == ANTIGRAVITY_PROVIDER_URL)
                    .map(|p| p.id.clone())
                    .unwrap_or_default()
            };
            if provider_id.is_empty() {
                return;
            }
            match state.refresh_antigravity_provider(&provider_id).await {
                Ok(snapshot) => {
                    AppState::emit_snapshot_event(&app_handle, snapshot);
                }
                Err(error) => {
                    log::warn!("Antigravity bootstrap failed: {error}");
                }
            }
        });
    }

    /// Refreshes the antigravity provider model list and persists the result.
    async fn refresh_antigravity_provider(&self, provider_id: &str) -> Result<AppSnapshot> {
        let provider = {
            let inner = self.lock()?;
            inner
                .providers
                .provider(provider_id)
                .ok_or_else(|| anyhow::anyhow!(ERR_NOT_FOUND_PROVIDER))?
                .clone()
        };
        let result = self
            .fetch_antigravity_models_for_provider(&provider)
            .await;
        let mut inner = self.lock()?;
        let provider = inner
            .providers
            .provider_mut(provider_id)
            .ok_or_else(|| anyhow::anyhow!(ERR_NOT_FOUND_PROVIDER))?;
        match result {
            Ok(models) => {
                let was_empty = provider.models.is_empty();
                provider.models = models;
                provider.enabled = true;
                provider.error.clear();
                if was_empty {
                    inner.ensure_selected_model();
                }
            }
            Err(error) => {
                provider.error = error.to_string();
                if provider.models.is_empty() {
                    provider.enabled = false;
                }
                inner.antigravity.error = error.to_string();
            }
        }
        inner.finalize_provider_state()
    }
}
