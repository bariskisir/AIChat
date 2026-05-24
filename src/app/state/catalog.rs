//! ChatGPT model catalog and usage-limit refresh helpers.

use super::AppState;
use crate::app::view::AppSnapshot;
use crate::infra::chatgpt;
use anyhow::Result;

impl AppState {
    /// Fetches the latest ChatGPT model catalog for the signed-in account.
    pub fn refresh_models(&self) -> Result<AppSnapshot> {
        let state = self.clone();
        self.runtime.block_on(async move {
            let access = state.access_context().await?;
            let mut catalog = chatgpt::fetch_model_catalog(&access).await?;
            catalog.chatgpt_limit_label = chatgpt::fetch_usage_limit_label(&access)
                .await
                .unwrap_or_default();
            let mut inner = state.lock()?;
            inner.catalog = catalog;
            inner.normalize_model_settings();
            inner.storage.save_catalog(&inner.catalog)?;
            inner.storage.save_settings(&inner.settings)?;
            inner.status = "ChatGPT models refreshed.".to_owned();
            Ok(inner.build_snapshot())
        })
    }

    /// Refreshes the displayed ChatGPT usage-limit label.
    pub fn refresh_limits(&self) -> Result<AppSnapshot> {
        let state = self.clone();
        self.runtime.block_on(async move {
            let access = state.access_context().await?;
            let limit = chatgpt::fetch_usage_limit_label(&access).await?;
            let mut inner = state.lock()?;
            inner.catalog.chatgpt_limit_label = limit;
            inner.storage.save_catalog(&inner.catalog)?;
            inner.status = "ChatGPT limits refreshed.".to_owned();
            Ok(inner.build_snapshot())
        })
    }
}
