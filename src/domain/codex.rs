//! Codex-specific auth, catalog, thinking, and verbosity models.

use super::{
    AvailableModel, DEFAULT_CODEX_CLIENT_VERSION, DEFAULT_CODEX_MODEL, DEFAULT_THINKING_VARIANT,
    DEFAULT_VERBOSITY, DEFAULT_VERBOSITY_SETTING,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStorage {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_at: i64,
    #[serde(default)]
    pub account_email: String,
    #[serde(default)]
    pub chatgpt_account_id: String,
    #[serde(default)]
    pub pending_oauth: Option<PendingOAuth>,
    #[serde(default)]
    pub error: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOAuth {
    pub state: String,
    pub verifier: String,
    pub started_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingVariantOption {
    pub value: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStorage {
    #[serde(default = "fallback_models")]
    pub available_models: Vec<AvailableModel>,
    #[serde(default = "default_codex_client_version")]
    pub codex_client_version: String,
    #[serde(default)]
    pub chatgpt_limit_label: String,
}

impl Default for CatalogStorage {
    /// Builds the default Codex catalog.
    fn default() -> Self {
        Self {
            available_models: fallback_models(),
            codex_client_version: DEFAULT_CODEX_CLIENT_VERSION.to_owned(),
            chatgpt_limit_label: String::new(),
        }
    }
}

impl AuthStorage {
    /// Reports whether a ChatGPT token is available.
    pub fn is_signed_in(&self) -> bool {
        !self.access_token.is_empty() || !self.refresh_token.is_empty()
    }
}

impl CatalogStorage {
    /// Finds thinking options for a Codex model.
    pub fn thinking_variants_for(&self, model: &str) -> Vec<ThinkingVariantOption> {
        self.available_models
            .iter()
            .find(|item| item.model == model)
            .or_else(|| {
                self.available_models
                    .iter()
                    .find(|item| item.model == DEFAULT_CODEX_MODEL)
            })
            .or_else(|| self.available_models.first())
            .map(|item| item.thinking_variants.clone())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(fallback_thinking_variants)
    }

    /// Keeps a thinking selection valid for a Codex model.
    pub fn normalize_thinking_variant(&self, value: &str, model: &str) -> String {
        let variants = self.thinking_variants_for(model);
        if variants.iter().any(|item| item.value == value) {
            value.to_owned()
        } else {
            self.available_models
                .iter()
                .find(|item| item.model == model)
                .map(|item| item.default_thinking_variant.clone())
                .filter(|item| !item.is_empty())
                .unwrap_or_else(|| DEFAULT_THINKING_VARIANT.to_owned())
        }
    }

    /// Keeps a verbosity value valid for a Codex model.
    pub fn normalize_verbosity(&self, value: &str, model: &str) -> String {
        let value = value.trim();
        if value == DEFAULT_VERBOSITY_SETTING {
            return DEFAULT_VERBOSITY_SETTING.to_owned();
        }
        if self.supports_verbosity(model) && is_verbosity_level(value) {
            value.to_owned()
        } else {
            DEFAULT_VERBOSITY_SETTING.to_owned()
        }
    }

    /// Resolves the effective Codex verbosity.
    pub fn resolve_verbosity(&self, value: &str, model: &str) -> String {
        let normalized = self.normalize_verbosity(value, model);
        if normalized != DEFAULT_VERBOSITY_SETTING {
            return normalized;
        }
        self.default_verbosity_for(model)
    }

    /// Reports whether a Codex model supports verbosity.
    pub fn supports_verbosity(&self, model: &str) -> bool {
        self.available_models
            .iter()
            .find(|item| item.model == model)
            .map(|item| item.support_verbosity)
            .unwrap_or(true)
    }

    /// Returns the Codex model default verbosity.
    pub fn default_verbosity_for(&self, model: &str) -> String {
        self.available_models
            .iter()
            .find(|item| item.model == model)
            .map(|item| item.default_verbosity.as_str())
            .filter(|value| is_verbosity_level(value))
            .unwrap_or(DEFAULT_VERBOSITY)
            .to_owned()
    }
}

/// Returns the pinned fallback Codex client version.
fn default_codex_client_version() -> String {
    DEFAULT_CODEX_CLIENT_VERSION.to_owned()
}

/// Builds the local fallback Codex model catalog.
pub fn fallback_models() -> Vec<AvailableModel> {
    vec![
        fallback_model(DEFAULT_CODEX_MODEL, true),
        fallback_model("gpt-5.4-mini", false),
    ]
}

/// Creates one fallback Codex model entry.
fn fallback_model(model: &str, is_default: bool) -> AvailableModel {
    AvailableModel {
        provider_id: String::new(),
        provider_name: String::new(),
        model: model.to_owned(),
        display_name: model.to_owned(),
        description: String::new(),
        hidden: false,
        is_default,
        input_modalities: default_input_modalities(),
        default_thinking_variant: default_thinking_variant(),
        thinking_variants: fallback_thinking_variants(),
        support_verbosity: true,
        default_verbosity: default_verbosity(),
    }
}

/// Returns default Codex input modalities.
pub fn default_input_modalities() -> Vec<String> {
    vec!["text".to_owned(), "image".to_owned()]
}

/// Returns the fallback Codex thinking value.
pub fn default_thinking_variant() -> String {
    DEFAULT_THINKING_VARIANT.to_owned()
}

/// Returns the fallback Codex verbosity support flag.
pub fn default_support_verbosity() -> bool {
    true
}

/// Returns the fallback Codex verbosity value.
pub fn default_verbosity() -> String {
    DEFAULT_VERBOSITY.to_owned()
}

/// Builds fallback Codex thinking options.
pub fn fallback_thinking_variants() -> Vec<ThinkingVariantOption> {
    vec![
        thinking("low", "Fast responses with lighter reasoning"),
        thinking("medium", "Balanced reasoning for everyday tasks"),
        thinking("high", "Greater reasoning depth for complex tasks"),
        thinking("xhigh", "Extra high reasoning depth for complex tasks"),
    ]
}

/// Reports whether a value is one of the supported verbosity levels.
fn is_verbosity_level(value: &str) -> bool {
    matches!(value, "low" | "medium" | "high")
}

/// Creates one thinking option.
fn thinking(value: &str, description: &str) -> ThinkingVariantOption {
    ThinkingVariantOption {
        value: value.to_owned(),
        description: description.to_owned(),
    }
}
