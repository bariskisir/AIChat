//! Provider configuration and model refresh helpers.

use super::AppState;
use crate::app::view::{AppSnapshot, ProviderInput};
use crate::domain::{CustomHeader, OPENCODE_PROVIDER_ID, ProviderConfig, split_model_key};
use crate::infra::openai::{self, OpenAiContext};
use anyhow::{Result, anyhow};

impl AppState {
    /// Saves a provider and refreshes its model list when possible.
    pub async fn save_provider(&self, input: ProviderInput) -> Result<AppSnapshot> {
        let provider = provider_from_input(input)?;
        let provider_id = {
            let mut inner = self.lock()?;
            let id = inner.providers.upsert(provider);
            inner.status = "Provider saved. Refreshing models...".to_owned();
            inner.storage.save_providers(&inner.providers)?;
            id
        };
        self.refresh_provider_models(&provider_id).await
    }

    /// Deletes a provider and repairs the selected model.
    pub fn delete_provider(&self, provider_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        if inner
            .providers
            .provider(provider_id)
            .is_some_and(|provider| provider.built_in)
        {
            return Err(anyhow!("Built-in providers cannot be deleted."));
        }
        if !inner.providers.delete(provider_id) {
            return Err(anyhow!("Provider not found."));
        }
        inner.ensure_selected_model();
        inner.save_active_session_model_settings()?;
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        inner.status = "Provider deleted.".to_owned();
        Ok(inner.build_snapshot())
    }

    /// Refreshes all configured providers.
    pub async fn refresh_all_models(&self) -> Result<AppSnapshot> {
        let provider_ids = {
            let inner = self.lock()?;
            inner
                .providers
                .providers
                .iter()
                .map(|provider| provider.id.clone())
                .collect::<Vec<_>>()
        };
        if provider_ids.is_empty() {
            let mut inner = self.lock()?;
            inner.status = "Add a provider first.".to_owned();
            return Ok(inner.build_snapshot());
        }
        let mut last_snapshot = None;
        let mut failures = Vec::new();
        for provider_id in provider_ids {
            match self.refresh_provider_models(&provider_id).await {
                Ok(snapshot) => last_snapshot = Some(snapshot),
                Err(error) => failures.push(error.to_string()),
            }
        }
        let provider_error_count = {
            let inner = self.lock()?;
            inner
                .providers
                .providers
                .iter()
                .filter(|provider| !provider.error.is_empty())
                .count()
        };
        if !failures.is_empty() || provider_error_count > 0 {
            let mut inner = self.lock()?;
            inner.status = format!(
                "Models refreshed with {} provider error(s).",
                failures.len() + provider_error_count
            );
            return Ok(inner.build_snapshot());
        }
        last_snapshot.ok_or_else(|| anyhow!("No providers configured."))
    }

    /// Refreshes one provider's model list from its `/models` endpoint.
    pub async fn refresh_provider_models(&self, provider_id: &str) -> Result<AppSnapshot> {
        let ctx = {
            let mut inner = self.lock()?;
            let ctx = {
                let provider = inner
                    .providers
                    .provider(provider_id)
                    .ok_or_else(|| anyhow!("Provider not found."))?;
                OpenAiContext::from_provider(provider)
            };
            inner.status = format!("Refreshing {} models...", ctx.provider_name);
            ctx
        };
        let result = openai::fetch_models(&ctx).await;
        let mut inner = self.lock()?;
        let provider = inner
            .providers
            .provider_mut(provider_id)
            .ok_or_else(|| anyhow!("Provider not found."))?;
        match result {
            Ok(models) => {
                let provider_name = provider.name.clone();
                provider.models =
                    if provider.id == OPENCODE_PROVIDER_ID && opencode_is_public(provider) {
                        filtered_opencode_models(models)
                    } else {
                        models
                    };
                provider.error.clear();
                inner.ensure_selected_model();
                inner.save_active_session_model_settings()?;
                inner.status = format!("{provider_name} models refreshed.");
            }
            Err(error) => {
                provider.error = error.to_string();
                inner.status = format!("Provider error: {error}");
            }
        }
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(inner.build_snapshot())
    }

    /// Builds a request context and model id from the current selection.
    pub(super) fn selected_provider_context(&self) -> Result<(OpenAiContext, String)> {
        let inner = self.lock()?;
        let (provider_id, model) = split_model_key(&inner.settings.model)
            .ok_or_else(|| anyhow!("Select a provider model first."))?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!("Selected provider was not found."))?;
        Ok((OpenAiContext::from_provider(provider), model.to_owned()))
    }

    /// Ensures commands that require a provider have one.
    pub(super) fn ensure_provider_ready(&self) -> Result<()> {
        let inner = self.lock()?;
        if inner.providers.providers.is_empty() {
            return Err(anyhow!("Add a provider first."));
        }
        if inner.settings.model.is_empty() {
            return Err(anyhow!("Select a provider model first."));
        }
        Ok(())
    }
}

/// Validates user input and creates a provider config.
fn provider_from_input(input: ProviderInput) -> Result<ProviderConfig> {
    let name = input.name.trim();
    let api_url = input.api_url.trim().trim_end_matches('/');
    let api_key = input.api_key.trim();
    let custom_headers = parse_custom_headers(&input.custom_headers)?;
    if name.is_empty() {
        return Err(anyhow!("Provider name is required."));
    }
    if api_url.is_empty() {
        return Err(anyhow!("API URL is required."));
    }
    Ok(ProviderConfig {
        id: input.id.trim().to_owned(),
        name: name.to_owned(),
        api_url: api_url.to_owned(),
        api_key: api_key.to_owned(),
        custom_headers,
        built_in: false,
        models: Vec::new(),
        error: String::new(),
    })
}

/// Parses a provider custom header JSON object from the UI.
fn parse_custom_headers(value: &str) -> Result<Vec<CustomHeader>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let parsed: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|error| anyhow!("Custom headers must be a JSON object: {error}"))?;
    let object = parsed
        .as_object()
        .ok_or_else(|| anyhow!("Custom headers must be a JSON object."))?;
    object
        .iter()
        .map(|(name, value)| {
            let Some(value) = value.as_str() else {
                return Err(anyhow!("Custom header values must be strings."));
            };
            Ok(CustomHeader {
                name: name.clone(),
                value: value.to_owned(),
            })
        })
        .collect()
}

/// Reports whether OpenCode is using the public session.
fn opencode_is_public(provider: &ProviderConfig) -> bool {
    provider.api_key.trim().eq_ignore_ascii_case("public")
}

/// Applies the OpenCode free-model restriction and keeps the default model first.
fn filtered_opencode_models(
    mut models: Vec<crate::domain::AvailableModel>,
) -> Vec<crate::domain::AvailableModel> {
    models.retain(|model| model.model.to_lowercase().contains("free"));
    if !models
        .iter()
        .any(|model| model.model == crate::domain::OPENCODE_DEFAULT_MODEL)
    {
        models.push(crate::domain::AvailableModel {
            provider_id: OPENCODE_PROVIDER_ID.to_owned(),
            provider_name: "OpenCode Zen".to_owned(),
            model: crate::domain::OPENCODE_DEFAULT_MODEL.to_owned(),
            display_name: crate::domain::OPENCODE_DEFAULT_MODEL.to_owned(),
            description: "OpenCode Zen default free model".to_owned(),
            hidden: false,
        });
    }
    models.sort_by(|left, right| {
        let left_default = left.model == crate::domain::OPENCODE_DEFAULT_MODEL;
        let right_default = right.model == crate::domain::OPENCODE_DEFAULT_MODEL;
        right_default
            .cmp(&left_default)
            .then_with(|| left.model.cmp(&right.model))
    });
    models
}
