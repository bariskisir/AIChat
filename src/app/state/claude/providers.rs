//! Claude provider detection and model refresh state helpers.

use super::super::AppState;
use crate::domain::{AvailableModel, CLAUDE_PROVIDER_URL, ProviderConfig};
use crate::infra::{claude, extractor::BrowserExtractor};
use anyhow::{Result, anyhow};

impl AppState {
    /// Fetches Claude models for a provider through stored Claude.ai browser auth.
    pub(in crate::app::state) async fn fetch_claude_models_for_provider(
        &self,
        provider: &ProviderConfig,
    ) -> Result<Vec<AvailableModel>> {
        let (ctx, org_id, cookies, plan) = {
            let inner = self.lock()?;
            if !inner.claude_auth.is_signed_in() {
                return Err(anyhow!("Connect to Claude first."));
            }
            (
                claude::ClaudeContext::from_credential(&inner.claude_auth),
                inner.claude_auth.org_id.clone(),
                inner.claude_auth.cookies.clone(),
                inner.claude_auth.plan.clone(),
            )
        };
        let (mut models, account_info) = match claude::fetch_bootstrap_json(&ctx).await {
            Ok(json) => (
                claude::parse_model_response_for_plan(&json, Some(&ctx.plan))?,
                claude::parse_account_info(&json),
            ),
            Err(error) => {
                log::warn!("Direct Claude model refresh failed, trying browser fetch: {error}");
                let json =
                    BrowserExtractor::fetch_bootstrap_with_cookies(&org_id, &cookies).await?;
                (
                    claude::parse_model_response_for_plan(&json, Some(&plan))?,
                    claude::parse_account_info(&json),
                )
            }
        };
        for model in &mut models {
            model.provider_id = provider.id.clone();
            model.provider_name = provider.name.clone();
        }
        let mut inner = self.lock()?;
        if !account_info.0.is_empty() {
            inner.claude_auth.email = account_info.0;
        }
        if !account_info.1.is_empty() {
            inner.claude_auth.plan = account_info.1;
        }
        inner.storage.save_claude_auth(&inner.claude_auth)?;
        Ok(models)
    }
}

/// Reports whether a provider uses the Claude.ai web backend.
pub(in crate::app::state) fn is_claude_provider(provider: &ProviderConfig) -> bool {
    provider
        .api_url
        .trim()
        .eq_ignore_ascii_case(CLAUDE_PROVIDER_URL)
}
