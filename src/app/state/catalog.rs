//! Claude model catalog refresh from the Claude web bootstrap endpoint.

use super::AppState;
use crate::app::view::AppSnapshot;
use crate::infra::{claude, extractor::BrowserExtractor};
use anyhow::{Result, anyhow};

impl AppState {
    /// Refreshes models from Claude bootstrap data and updates account metadata.
    pub async fn refresh_models(&self) -> Result<AppSnapshot> {
        let (ctx, org_id, cookies, plan) = {
            let inner = self.lock()?;
            if !inner.auth.is_signed_in() {
                return Err(anyhow!("Connect to Claude first."));
            }
            (
                claude::ClaudeContext::from_credential(&inner.auth),
                inner.auth.org_id.clone(),
                inner.auth.cookies.clone(),
                inner.auth.plan.clone(),
            )
        };
        self.set_status("Refreshing Claude models...");

        let (models, account_info) = match claude::fetch_bootstrap_json(&ctx).await {
            Ok(json) => (
                claude::parse_model_response_for_plan(&json, Some(&ctx.plan))?,
                claude::parse_account_info(&json),
            ),
            Err(error) => {
                log::warn!("Direct model refresh failed, trying browser fetch: {error}");
                let json =
                    BrowserExtractor::fetch_bootstrap_with_cookies(&org_id, &cookies).await?;
                (
                    claude::parse_model_response_for_plan(&json, Some(&plan))?,
                    claude::parse_account_info(&json),
                )
            }
        };

        let mut inner = self.lock()?;
        if !account_info.0.is_empty() {
            inner.auth.email = account_info.0;
        }
        if !account_info.1.is_empty() {
            inner.auth.plan = account_info.1;
        }
        inner.catalog.set_models(models);
        inner.ensure_selected_model();
        inner.save_active_session_model_settings()?;
        inner.storage.save_catalog(&inner.catalog)?;
        inner.storage.save_auth(&inner.auth)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        inner.status = "Models refreshed.".to_owned();
        Ok(inner.build_snapshot())
    }

    /// Reports that Claude usage limits are not currently exposed here.
    pub fn refresh_limits(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.status = "Usage limits not applicable for Claude.".to_owned();
        Ok(inner.build_snapshot())
    }
}
