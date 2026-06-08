//! Claude Code credential context, model refresh, and startup bootstrap helpers.

use super::super::AppState;
use crate::app::events::UiEvent;
use crate::domain::{AvailableModel, CLAUDE_CODE_PROVIDER_URL, ProviderConfig, model_key};
use crate::infra::claudecode::{self, ClaudeCodeContext};
use anyhow::Result;
use tauri::{AppHandle, Emitter};

impl AppState {
    /// Builds a Claude Code request context from local CLI credentials.
    pub(in crate::app::state) fn claude_code_context(&self) -> Result<ClaudeCodeContext> {
        let credentials = claudecode::read_credentials()?;
        Ok(ClaudeCodeContext::from_credentials(&credentials))
    }

    /// Fetches Claude Code models and usage from the Anthropic API.
    pub(in crate::app::state) async fn fetch_claude_code_models_for_provider(
        &self,
        provider: &ProviderConfig,
    ) -> Result<Vec<AvailableModel>> {
        let credentials = claudecode::read_credentials()?;
        let ctx = ClaudeCodeContext::from_credentials(&credentials);
        let mut models = claudecode::fetch_models(&ctx).await?;
        for model in &mut models {
            model.provider_id = provider.id.clone();
            model.provider_name = provider.name.clone();
        }
        let usage = claudecode::fetch_usage(&ctx).await.unwrap_or_default();
        let mut inner = self.lock()?;
        inner.claude_code.plan = credentials.plan;
        inner.claude_code.five_hour_label = usage.five_hour_label;
        inner.claude_code.seven_day_label = usage.seven_day_label;
        inner.claude_code.error.clear();
        Ok(models)
    }

    /// Loads Claude Code models in the background at startup when credentials exist.
    pub fn start_claude_code_bootstrap(&self, app_handle: AppHandle) {
        if !claudecode::credentials_available() {
            return;
        }
        let provider_id = {
            let Ok(inner) = self.lock() else { return };
            inner
                .providers
                .providers
                .iter()
                .find(|provider| provider.api_url.eq_ignore_ascii_case(CLAUDE_CODE_PROVIDER_URL))
                .map(|provider| provider.id.clone())
        };
        let Some(provider_id) = provider_id else {
            return;
        };
        let state = self.clone();
        self.runtime.spawn(async move {
            match state.refresh_claude_code_provider(&provider_id).await {
                Ok(snapshot) => {
                    let _ = app_handle.emit(
                        "app-event",
                        UiEvent::Snapshot {
                            snapshot: Box::new(snapshot),
                        },
                    );
                }
                Err(error) => {
                    log::warn!("Claude Code startup model load failed: {error}");
                }
            }
        });
    }

    /// Refreshes the Claude Code provider model list and persists the result.
    async fn refresh_claude_code_provider(
        &self,
        provider_id: &str,
    ) -> Result<crate::app::view::AppSnapshot> {
        let provider = {
            let inner = self.lock()?;
            inner
                .providers
                .provider(provider_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!(crate::domain::messages::ERR_NOT_FOUND_PROVIDER))?
        };
        let result = self.fetch_claude_code_models_for_provider(&provider).await;
        let mut inner = self.lock()?;
        let refreshed = match result {
            Ok(models) => {
                let provider = inner
                    .providers
                    .provider_mut(provider_id)
                    .ok_or_else(|| anyhow::anyhow!(crate::domain::messages::ERR_NOT_FOUND_PROVIDER))?;
                let was_empty = !provider.enabled || provider.models.is_empty();
                provider.models = models;
                provider.enabled = true;
                provider.error.clear();
                was_empty
            }
            Err(error) => {
                inner.claude_code.error = error.to_string();
                let provider = inner
                    .providers
                    .provider_mut(provider_id)
                    .ok_or_else(|| anyhow::anyhow!(crate::domain::messages::ERR_NOT_FOUND_PROVIDER))?;
                provider.error = error.to_string();
                // Keep previously loaded models usable when a startup refresh fails transiently.
                if provider.models.is_empty() {
                    provider.enabled = false;
                }
                false
            }
        };
        if refreshed && inner.settings.model.trim().is_empty() {
            let default_key = inner
                .providers
                .provider(provider_id)
                .and_then(|provider| provider.models.iter().find(|model| !model.hidden))
                .map(|model| model_key(provider_id, &model.model));
            if let Some(default_key) = default_key {
                inner.settings.model = default_key;
            }
        }
        inner.finalize_provider_state()
    }
}
