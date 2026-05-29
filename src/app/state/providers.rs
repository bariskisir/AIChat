//! Provider configuration and model refresh helpers.

use super::{AppState, claude, codex};
use crate::app::view::{AppSnapshot, ProviderInput};
use crate::domain::{CustomHeader, OPENCODE_PROVIDER_ID, ProviderConfig, split_model_key};
use crate::infra::openai::{self, OpenAiContext};
use anyhow::{Result, anyhow};

struct RefreshOutcome {
    snapshot: AppSnapshot,
    refreshed: bool,
}

impl AppState {
    /// Saves a provider only after its `/models` endpoint returns at least one model.
    pub async fn save_provider(&self, input: ProviderInput) -> Result<AppSnapshot> {
        let mut provider = provider_from_input(input)?;
        provider.models = if codex::is_codex_provider(&provider) {
            self.fetch_codex_models_for_provider(&provider).await?
        } else if claude::is_claude_provider(&provider) {
            self.fetch_claude_models_for_provider(&provider).await?
        } else {
            fetch_models_for_save(&provider).await?
        };
        {
            let mut inner = self.lock()?;
            let provider_name = provider.name.clone();
            inner.providers.upsert(provider);
            inner.ensure_selected_model();
            inner.save_active_session_model_settings()?;
            inner.status = format!("{provider_name} checked and saved.");
            inner.storage.save_providers(&inner.providers)?;
            inner.storage.save_settings(&inner.settings)?;
            inner.storage.save_sessions(&inner.sessions)?;
            Ok(inner.build_snapshot())
        }
    }

    /// Deletes a provider and repairs the selected model.
    pub fn delete_provider(&self, provider_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!("Provider not found."))?
            .clone();
        if provider.built_in {
            return Err(anyhow!("Built-in providers cannot be deleted."));
        }
        let deletes_codex = codex::is_codex_provider(&provider);
        let deletes_claude = claude::is_claude_provider(&provider);
        if !inner.providers.delete(provider_id) {
            return Err(anyhow!("Provider not found."));
        }
        if deletes_codex {
            inner.auth = crate::domain::AuthStorage::default();
            inner.storage.save_auth(&inner.auth)?;
        }
        if deletes_claude {
            inner.claude_auth = crate::domain::ClaudeCredential::default();
            inner.storage.save_claude_auth(&inner.claude_auth)?;
        }
        inner.ensure_selected_model();
        inner.save_active_session_model_settings()?;
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        inner.status = if deletes_codex {
            "Provider deleted and signed out of ChatGPT.".to_owned()
        } else if deletes_claude {
            "Provider deleted and signed out of Claude.".to_owned()
        } else {
            "Provider deleted.".to_owned()
        };
        Ok(inner.build_snapshot())
    }

    /// Refreshes all configured providers.
    pub async fn refresh_all_models(&self) -> Result<AppSnapshot> {
        let provider_ids = {
            let inner = self.lock()?;
            let codex_signed_in = inner.auth.is_signed_in();
            let claude_signed_in = inner.claude_auth.is_signed_in();
            inner
                .providers
                .providers
                .iter()
                .filter(|provider| {
                    (!codex::is_codex_provider(provider) || codex_signed_in)
                        && (!claude::is_claude_provider(provider) || claude_signed_in)
                })
                .map(|provider| provider.id.clone())
                .collect::<Vec<_>>()
        };
        if provider_ids.is_empty() {
            let mut inner = self.lock()?;
            inner.status = "Add a provider first.".to_owned();
            return Ok(inner.build_snapshot());
        }
        let mut refreshed = 0usize;
        let mut errors = 0usize;
        let mut last_snapshot = None;
        for provider_id in provider_ids {
            match self
                .refresh_provider_models_with_outcome(&provider_id)
                .await
            {
                Ok(outcome) => {
                    if outcome.refreshed {
                        refreshed += 1;
                    } else {
                        errors += 1;
                    }
                    last_snapshot = Some(outcome.snapshot);
                }
                Err(_) => errors += 1,
            }
        }
        let mut inner = self.lock()?;
        inner.status =
            format!("{refreshed} provider model(s) updated, {errors} provider error(s).");
        Ok(last_snapshot
            .map(|mut snapshot| {
                snapshot.status = inner.status.clone();
                snapshot
            })
            .unwrap_or_else(|| inner.build_snapshot()))
    }

    /// Refreshes one provider's model list from its `/models` endpoint.
    pub async fn refresh_provider_models(&self, provider_id: &str) -> Result<AppSnapshot> {
        Ok(self
            .refresh_provider_models_with_outcome(provider_id)
            .await?
            .snapshot)
    }

    /// Refreshes one provider and reports whether the model list updated.
    async fn refresh_provider_models_with_outcome(
        &self,
        provider_id: &str,
    ) -> Result<RefreshOutcome> {
        let provider = {
            let mut inner = self.lock()?;
            let provider = {
                inner
                    .providers
                    .provider(provider_id)
                    .ok_or_else(|| anyhow!("Provider not found."))?
                    .clone()
            };
            inner.status = format!("Refreshing {} models...", provider.name);
            provider
        };
        let result = if codex::is_codex_provider(&provider) {
            self.fetch_codex_models_for_provider(&provider).await
        } else if claude::is_claude_provider(&provider) {
            self.fetch_claude_models_for_provider(&provider).await
        } else {
            openai::fetch_models(&OpenAiContext::from_provider(&provider)).await
        };
        let mut inner = self.lock()?;
        let provider = inner
            .providers
            .provider_mut(provider_id)
            .ok_or_else(|| anyhow!("Provider not found."))?;
        let refreshed = match result {
            Ok(models) => {
                let provider_name = provider.name.clone();
                provider.models =
                    if provider.id == OPENCODE_PROVIDER_ID && opencode_is_public(provider) {
                        filtered_opencode_models(models)
                    } else {
                        models
                    };
                provider.enabled = true;
                provider.error.clear();
                inner.ensure_selected_model();
                inner.save_active_session_model_settings()?;
                inner.status = format!("{provider_name} models refreshed.");
                true
            }
            Err(error) => {
                provider.error = error.to_string();
                provider.enabled = false;
                inner.ensure_selected_model();
                inner.save_active_session_model_settings()?;
                inner.status = format!("Provider error: {error}");
                false
            }
        };
        inner.storage.save_providers(&inner.providers)?;
        inner.storage.save_settings(&inner.settings)?;
        inner.storage.save_sessions(&inner.sessions)?;
        Ok(RefreshOutcome {
            snapshot: inner.build_snapshot(),
            refreshed,
        })
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
        if !provider.enabled {
            return Err(anyhow!(
                "Selected provider is disabled after a model refresh error."
            ));
        }
        Ok((OpenAiContext::from_provider(provider), model.to_owned()))
    }

    /// Returns whether the selected model belongs to the Codex provider.
    pub(super) fn selected_provider_is_codex(&self) -> Result<bool> {
        let inner = self.lock()?;
        let (provider_id, _) = split_model_key(&inner.settings.model)
            .ok_or_else(|| anyhow!("Select a provider model first."))?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!("Selected provider was not found."))?;
        Ok(codex::is_codex_provider(provider))
    }

    /// Returns whether the selected model belongs to the Claude provider.
    pub(super) fn selected_provider_is_claude(&self) -> Result<bool> {
        let inner = self.lock()?;
        let (provider_id, _) = split_model_key(&inner.settings.model)
            .ok_or_else(|| anyhow!("Select a provider model first."))?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!("Selected provider was not found."))?;
        Ok(claude::is_claude_provider(provider))
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
        enabled: true,
        models: Vec::new(),
        error: String::new(),
    })
}

/// Fetches and validates a provider model list before saving user input.
async fn fetch_models_for_save(
    provider: &ProviderConfig,
) -> Result<Vec<crate::domain::AvailableModel>> {
    let ctx = OpenAiContext::from_provider(provider);
    let models = openai::fetch_models(&ctx).await?;
    if models.is_empty() {
        return Err(anyhow!(
            "{} /models returned an empty model list; provider was not saved.",
            provider.name
        ));
    }
    Ok(models)
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
            is_default: true,
            input_modalities: vec!["text".to_owned()],
            default_thinking_variant: crate::domain::DEFAULT_THINKING_VARIANT.to_owned(),
            thinking_variants: crate::domain::fallback_thinking_variants(),
            support_verbosity: false,
            default_verbosity: crate::domain::DEFAULT_VERBOSITY.to_owned(),
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
