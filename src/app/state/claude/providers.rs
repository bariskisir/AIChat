//! Claude provider detection and model refresh state helpers.

use super::super::AppState;
use crate::domain::{AvailableModel, ProviderConfig};
use crate::domain::messages::*;
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
            let auth = inner
                .get_claude_auth()
                .ok_or_else(|| anyhow!(AUTH_CONNECT_CLAUDE_WEB_REQUIRED))?;
            if !auth.is_signed_in() {
                return Err(anyhow!(AUTH_CONNECT_CLAUDE_WEB_REQUIRED));
            }
            (
                claude::ClaudeContext::from_credential(auth),
                auth.org_id.clone(),
                auth.cookies.clone(),
                auth.plan.clone(),
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
        if let Some(auth) = inner.get_claude_auth_mut() {
            if !account_info.0.is_empty() {
                auth.email = account_info.0;
            }
            if !account_info.1.is_empty() {
                auth.plan = account_info.1;
            }
        }
        Ok(models)
    }
}

