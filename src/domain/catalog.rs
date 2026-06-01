//! Model catalog storage and available model types for AI Chat.

use super::{
    DEFAULT_CODEX_CLIENT_VERSION, DEFAULT_CODEX_MODEL, DEFAULT_THINKING_VARIANT, DEFAULT_VERBOSITY,
    DEFAULT_VERBOSITY_SETTING, default_codex_client_version, default_input_modalities,
    default_support_verbosity, default_thinking_variant, default_verbosity, fallback_models,
    fallback_thinking_variants, is_verbosity_level,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingVariantOption {
    pub value: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub provider_name: String,
    pub model: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default = "default_input_modalities")]
    pub input_modalities: Vec<String>,
    #[serde(default = "default_thinking_variant")]
    pub default_thinking_variant: String,
    #[serde(default = "fallback_thinking_variants")]
    pub thinking_variants: Vec<ThinkingVariantOption>,
    #[serde(default = "default_support_verbosity")]
    pub support_verbosity: bool,
    #[serde(default = "default_verbosity")]
    pub default_verbosity: String,
    #[serde(default)]
    pub claude_thinking_type: String,
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
