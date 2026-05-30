//! Provider configuration and model refresh helpers.

use super::{AppState};
use crate::app::view::{AppSnapshot, ProviderInput};
use crate::domain::{CustomHeader, OPENCODE_PROVIDER_ID, ProviderConfig, ProviderKind, split_model_key};
use crate::domain::messages::*;
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
        provider.models = if provider.kind() == ProviderKind::Codex {
            self.fetch_codex_models_for_provider(&provider).await?
        } else if provider.kind() == ProviderKind::Claude {
            self.fetch_claude_models_for_provider(&provider).await?
        } else {
            fetch_models_for_save(&provider).await?
        };
        {
            let mut inner = self.lock()?;
            let provider_name = provider.name.clone();
            inner.providers.upsert(provider);
            inner.status = format!("{provider_name} checked and saved.");
            inner.finalize_provider_state()
        }
    }

    /// Deletes a provider and repairs the selected model.
    pub fn delete_provider(&self, provider_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?
            .clone();
        if provider.built_in {
            return Err(anyhow!(ERR_VALIDATION_BUILTIN_DELETE));
        }
        if !inner.providers.delete(provider_id) {
            return Err(anyhow!(ERR_NOT_FOUND_PROVIDER));
        }
        inner.status = match provider.kind() {
            ProviderKind::Codex => {
                inner.auth = crate::domain::AuthStorage::default();
                inner.storage.save_auth(&inner.auth)?;
                STATUS_PROVIDER_DELETED_AND_SIGNED_OUT_CHATGPT.to_owned()
            }
            ProviderKind::Claude => {
                inner.claude_auth = crate::domain::ClaudeCredential::default();
                inner.storage.save_claude_auth(&inner.claude_auth)?;
                STATUS_PROVIDER_DELETED_AND_SIGNED_OUT_CLAUDE.to_owned()
            }
            _ => STATUS_PROVIDER_DELETED.to_owned(),
        };
        inner.finalize_provider_state()
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
                    (provider.kind() != ProviderKind::Codex || codex_signed_in)
                        && (provider.kind() != ProviderKind::Claude || claude_signed_in)
                })
                .map(|provider| provider.id.clone())
                .collect::<Vec<_>>()
        };
        if provider_ids.is_empty() {
            let mut inner = self.lock()?;
            inner.status = STATUS_ADD_PROVIDER_FIRST.to_owned();
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
                    .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?
                    .clone()
            };
            inner.status = format!("Refreshing {} models...", provider.name);
            provider
        };
        let result = if provider.kind() == ProviderKind::Codex {
            self.fetch_codex_models_for_provider(&provider).await
        } else if provider.kind() == ProviderKind::Claude {
            self.fetch_claude_models_for_provider(&provider).await
        } else {
            openai::fetch_models(&OpenAiContext::from_provider(&provider)).await
        };
        let mut inner = self.lock()?;
        let provider = inner
            .providers
            .provider_mut(provider_id)
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_PROVIDER))?;
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
                inner.status = format!("{provider_name} models refreshed.");
                true
            }
            Err(error) => {
                provider.error = error.to_string();
                provider.enabled = false;
                inner.status = format!("Provider error: {error}");
                false
            }
        };
        let snapshot = inner.finalize_provider_state()?;
        Ok(RefreshOutcome {
            snapshot,
            refreshed,
        })
    }

    /// Builds a request context and model id from the current selection.
    pub(super) fn selected_provider_context(&self) -> Result<(OpenAiContext, String)> {
        let inner = self.lock()?;
        let (provider_id, model) = split_model_key(&inner.settings.model)
            .ok_or_else(|| anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST))?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_SELECTED_PROVIDER))?;
        if !provider.enabled {
            return Err(anyhow!(
                ERR_VALIDATION_PROVIDER_DISABLED
            ));
        }
        Ok((OpenAiContext::from_provider(provider), model.to_owned()))
    }

    /// Returns whether the selected model belongs to the Codex provider.
    pub(super) fn selected_provider_is_codex(&self) -> Result<bool> {
        let inner = self.lock()?;
        let (provider_id, _) = split_model_key(&inner.settings.model)
            .ok_or_else(|| anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST))?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_SELECTED_PROVIDER))?;
        Ok(provider.kind() == ProviderKind::Codex)
    }

    /// Returns whether the selected model belongs to the Claude provider.
    pub(super) fn selected_provider_is_claude(&self) -> Result<bool> {
        let inner = self.lock()?;
        let (provider_id, _) = split_model_key(&inner.settings.model)
            .ok_or_else(|| anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST))?;
        let provider = inner
            .providers
            .provider(provider_id)
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_SELECTED_PROVIDER))?;
        Ok(provider.kind() == ProviderKind::Claude)
    }

    /// Ensures commands that require a provider have one.
    pub(super) fn ensure_provider_ready(&self) -> Result<()> {
        let inner = self.lock()?;
        if inner.providers.providers.is_empty() {
            return Err(anyhow!(ERR_VALIDATION_ADD_PROVIDER_FIRST));
        }
        if inner.settings.model.is_empty() {
            return Err(anyhow!(ERR_VALIDATION_SELECT_MODEL_FIRST));
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
        return Err(anyhow!(ERR_VALIDATION_PROVIDER_NAME_REQUIRED));
    }
    if api_url.is_empty() {
        return Err(anyhow!(ERR_VALIDATION_API_URL_REQUIRED));
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
        .map_err(|error| anyhow!("{}: {error}", ERR_VALIDATION_HEADERS_JSON_OBJECT))?;
    let object = parsed
        .as_object()
        .ok_or_else(|| anyhow!(ERR_VALIDATION_HEADERS_JSON_OBJECT))?;
    object
        .iter()
        .map(|(name, value)| {
            let Some(value) = value.as_str() else {
                return Err(anyhow!(ERR_VALIDATION_HEADER_VALUES_STRINGS));
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
            provider_name: PROVIDER_OPENCODE_NAME.to_owned(),
            model: crate::domain::OPENCODE_DEFAULT_MODEL.to_owned(),
            display_name: crate::domain::OPENCODE_DEFAULT_MODEL.to_owned(),
            description: PROVIDER_OPENCODE_DEFAULT_MODEL_DESC.to_owned(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        AvailableModel, DEFAULT_THINKING_VARIANT, DEFAULT_VERBOSITY, OPENCODE_DEFAULT_MODEL,
    };

    /// Builds a minimal available model fixture for provider filtering tests.
    fn model(id: &str) -> AvailableModel {
        AvailableModel {
            provider_id: OPENCODE_PROVIDER_ID.to_owned(),
            provider_name: PROVIDER_OPENCODE_NAME.to_owned(),
            model: id.to_owned(),
            display_name: id.to_owned(),
            description: String::new(),
            hidden: false,
            is_default: false,
            input_modalities: vec!["text".to_owned()],
            default_thinking_variant: DEFAULT_THINKING_VARIANT.to_owned(),
            thinking_variants: crate::domain::fallback_thinking_variants(),
            support_verbosity: false,
            default_verbosity: DEFAULT_VERBOSITY.to_owned(),
        }
    }

    /// Accepts structured custom headers from the provider editor JSON field.
    #[test]
    fn parse_custom_headers_accepts_string_object() {
        let headers = parse_custom_headers(r#"{ "x-test": "one", "x-empty": "" }"#).unwrap();

        assert_eq!(headers.len(), 2);
        assert!(
            headers
                .iter()
                .any(|item| item.name == "x-test" && item.value == "one")
        );
        assert!(
            headers
                .iter()
                .any(|item| item.name == "x-empty" && item.value.is_empty())
        );
    }

    /// Rejects malformed custom header values before a provider is saved.
    #[test]
    fn parse_custom_headers_rejects_non_string_values() {
        let error = parse_custom_headers(r#"{ "x-test": 1 }"#).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("Custom header values must be strings")
        );
    }

    /// Keeps only free OpenCode models and injects the default free model when absent.
    #[test]
    fn filtered_opencode_models_keeps_free_models_with_default_first() {
        let models = filtered_opencode_models(vec![model("paid-model"), model("alpha-free")]);

        assert!(
            models
                .iter()
                .all(|item| item.model.to_lowercase().contains("free"))
        );
        assert_eq!(
            models.first().map(|item| item.model.as_str()),
            Some(OPENCODE_DEFAULT_MODEL)
        );
        assert!(models.iter().any(|item| item.model == "alpha-free"));
    }
}
