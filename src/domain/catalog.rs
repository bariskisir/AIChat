//! Model catalog storage and available model types for AI Chat.

use super::{
    DEFAULT_THINKING_VARIANT, DEFAULT_VERBOSITY,
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub provider_name: String,
    pub model: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default = "default_input_modalities")]
    pub input_modalities: Vec<String>,
    #[serde(default = "default_thinking_variant")]
    pub default_thinking_variant: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thinking_variants: Vec<ThinkingVariantOption>,
    #[serde(default = "default_support_verbosity")]
    pub support_verbosity: bool,
    #[serde(default = "default_verbosity")]
    pub default_verbosity: String,
    #[serde(default)]
    pub claude_thinking_type: String,
}

/// Codex model catalog fetched from the ChatGPT API.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStorage {
    #[serde(default = "fallback_models")]
    pub available_models: Vec<AvailableModel>,
    #[serde(default = "default_codex_client_version")]
    #[allow(dead_code)]
    pub codex_client_version: String,
    #[serde(default)]
    pub chatgpt_limit_label: String,
}

/// Finds thinking options for a model across all available models.
pub fn thinking_variants_for(models: &[AvailableModel], model: &str) -> Vec<ThinkingVariantOption> {
    models
        .iter()
        .find(|item| item.model == model)
        .map(|item| item.thinking_variants.clone())
        .filter(|items| !items.is_empty())
        .unwrap_or_else(fallback_thinking_variants)
}

/// Keeps a thinking selection valid for a model.
pub fn normalize_thinking_variant(models: &[AvailableModel], value: &str, model: &str) -> String {
    let variants = thinking_variants_for(models, model);
    if variants.iter().any(|item| item.value == value) {
        value.to_owned()
    } else {
        models
            .iter()
            .find(|item| item.model == model)
            .map(|item| item.default_thinking_variant.clone())
            .filter(|item| !item.is_empty())
            .unwrap_or_else(|| DEFAULT_THINKING_VARIANT.to_owned())
    }
}

/// Keeps a verbosity value valid for a model.
pub fn normalize_verbosity(models: &[AvailableModel], value: &str, model: &str) -> String {
    let value = value.trim();
    if value == DEFAULT_VERBOSITY_SETTING {
        return DEFAULT_VERBOSITY_SETTING.to_owned();
    }
    if supports_verbosity(models, model) && is_verbosity_level(value) {
        value.to_owned()
    } else {
        DEFAULT_VERBOSITY_SETTING.to_owned()
    }
}

/// Resolves the effective verbosity for a model.
pub fn resolve_verbosity(models: &[AvailableModel], value: &str, model: &str) -> String {
    let normalized = normalize_verbosity(models, value, model);
    if normalized != DEFAULT_VERBOSITY_SETTING {
        return normalized;
    }
    default_verbosity_for(models, model)
}

/// Reports whether a model supports verbosity.
pub fn supports_verbosity(models: &[AvailableModel], model: &str) -> bool {
    models
        .iter()
        .find(|item| item.model == model)
        .map(|item| item.support_verbosity)
        .unwrap_or(false)
}

/// Returns the model default verbosity.
pub fn default_verbosity_for(models: &[AvailableModel], model: &str) -> String {
    models
        .iter()
        .find(|item| item.model == model)
        .map(|item| item.default_verbosity.as_str())
        .filter(|value| is_verbosity_level(value))
        .unwrap_or(DEFAULT_VERBOSITY)
        .to_owned()
}
