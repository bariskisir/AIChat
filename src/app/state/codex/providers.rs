//! Codex provider detection and model refresh state helpers.

use super::super::AppState;
use crate::domain::{AvailableModel, CODEX_PROVIDER_URL, ProviderConfig};
use anyhow::Result;

impl AppState {
    /// Fetches Codex models for a provider through ChatGPT account auth.
    pub(in crate::app::state) async fn fetch_codex_models_for_provider(
        &self,
        provider: &ProviderConfig,
    ) -> Result<Vec<AvailableModel>> {
        let access = self.codex_access_context().await?;
        let mut catalog = crate::infra::chatgpt::fetch_model_catalog(&access).await?;
        catalog.chatgpt_limit_label = crate::infra::chatgpt::fetch_usage_limit_label(&access)
            .await
            .unwrap_or_default();
        let mut models = catalog.available_models.clone();
        for model in &mut models {
            model.provider_id = provider.id.clone();
            model.provider_name = provider.name.clone();
        }
        let mut inner = self.lock()?;
        inner.catalog = catalog;
        inner.storage.save_catalog(&inner.catalog)?;
        Ok(models)
    }
}

/// Reports whether a provider uses the Codex ChatGPT backend.
pub(in crate::app::state) fn is_codex_provider(provider: &ProviderConfig) -> bool {
    provider
        .api_url
        .trim()
        .eq_ignore_ascii_case(CODEX_PROVIDER_URL)
}
