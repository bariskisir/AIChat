//! Codex ChatGPT model catalog and usage helpers for shared application state.

use super::super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::AppSnapshot;
use crate::domain::messages::*;
use crate::domain::{CODEX_PROVIDER_URL, CodexCredentials, ProviderConfig, model_key};
use crate::infra::chatgpt;
use anyhow::{Result, anyhow};
use tauri::{AppHandle, Emitter};

impl AppState {
    /// Returns Codex credentials from the local CLI auth store.
    #[allow(dead_code)]
    fn codex_credentials(&self) -> Result<CodexCredentials> {
        crate::infra::codex_credentials::read_credentials()
    }

    /// Fetches Codex models and usage through the local CLI credentials.
    pub(in crate::app::state) async fn fetch_codex_models_for_provider(
        &self,
        provider: &ProviderConfig,
    ) -> Result<Vec<crate::domain::AvailableModel>> {
        let credentials = crate::infra::codex_credentials::read_credentials()?;
        let access = chatgpt::AccessContext {
            access_token: credentials.access_token.clone(),
            chatgpt_account_id: credentials.account_id.clone(),
        };
        let mut catalog = chatgpt::fetch_model_catalog(&access).await?;
        catalog.chatgpt_limit_label = chatgpt::fetch_usage_limit_label(&access)
            .await
            .unwrap_or_default();
        let mut models = catalog.available_models.clone();
        for model in &mut models {
            model.provider_id = provider.id.clone();
            model.provider_name = provider.name.clone();
        }
        let mut inner = self.lock()?;
        inner.codex.plan = capitalize_plan(&credentials.plan);
        inner.codex.email = credentials.email;
        inner.codex.limit_label = strip_plan_prefix(
            &catalog.chatgpt_limit_label,
            &inner.codex.plan,
        );
        inner.codex.error.clear();
        Ok(models)
    }

    /// Loads Codex models in the background at startup when credentials exist.
    pub fn start_codex_bootstrap(&self, app_handle: AppHandle) {
        if !crate::infra::codex_credentials::credentials_available() {
            return;
        }
        let provider_id = {
            let Ok(inner) = self.lock() else { return };
            inner
                .providers
                .providers
                .iter()
                .find(|provider| provider.api_url.eq_ignore_ascii_case(CODEX_PROVIDER_URL))
                .map(|provider| provider.id.clone())
        };
        let Some(provider_id) = provider_id else {
            return;
        };
        let state = self.clone();
        self.runtime.spawn(async move {
            match state.refresh_codex_provider(&provider_id).await {
                Ok(snapshot) => {
                    let _ = app_handle.emit(
                        "app-event",
                        UiEvent::Snapshot {
                            snapshot: Box::new(snapshot),
                        },
                    );
                }
                Err(error) => {
                    log::warn!("Codex startup model load failed: {error}");
                }
            }
        });
    }

    /// Refreshes the Codex provider model list and persists the result.
    async fn refresh_codex_provider(
        &self,
        provider_id: &str,
    ) -> Result<AppSnapshot> {
        let provider = {
            let inner = self.lock()?;
            inner
                .providers
                .provider(provider_id)
                .cloned()
                .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?
        };
        let result = self.fetch_codex_models_for_provider(&provider).await;
        let mut inner = self.lock()?;
        let refreshed = match result {
            Ok(models) => {
                let provider = inner
                    .providers
                    .provider_mut(provider_id)
                    .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?;
                let was_empty = !provider.enabled || provider.models.is_empty();
                provider.models = models;
                provider.enabled = true;
                provider.error.clear();
                was_empty
            }
            Err(error) => {
                inner.codex.error = error.to_string();
                let provider = inner
                    .providers
                    .provider_mut(provider_id)
                    .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?;
                provider.error = error.to_string();
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

/// Capitalizes the first letter of a plan name.
fn capitalize_plan(plan: &str) -> String {
    let mut chars = plan.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

/// Strips the leading plan prefix from a ChatGPT usage label.
fn strip_plan_prefix(label: &str, plan: &str) -> String {
    let prefix = format!("{plan}, ");
    if label.starts_with(&prefix) {
        label[prefix.len()..].to_owned()
    } else {
        label.to_owned()
    }
}
