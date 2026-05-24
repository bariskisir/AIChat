//! Auth, model catalog, and thinking variant models.

use super::{DEFAULT_CODEX_CLIENT_VERSION, DEFAULT_THINKING_VARIANT};
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
pub struct CatalogStorage {
    #[serde(default = "fallback_models")]
    pub available_models: Vec<AvailableModel>,
    #[serde(default = "default_codex_client_version")]
    pub codex_client_version: String,
    #[serde(default)]
    pub chatgpt_limit_label: String,
}

impl Default for CatalogStorage {
    /// Builds the default value for this type.
    fn default() -> Self {
        Self {
            available_models: fallback_models(),
            codex_client_version: DEFAULT_CODEX_CLIENT_VERSION.to_owned(),
            chatgpt_limit_label: String::new(),
        }
    }
}

impl AuthStorage {
    /// Reports whether any usable ChatGPT token is stored.
    pub fn is_signed_in(&self) -> bool {
        !self.access_token.is_empty() || !self.refresh_token.is_empty()
    }
}

impl CatalogStorage {
    /// Keeps a model selection valid against the current catalog.
    pub fn normalize_model(&self, value: &str) -> String {
        if self.available_models.iter().any(|item| item.model == value) {
            value.to_owned()
        } else {
            self.available_models
                .iter()
                .find(|item| item.is_default)
                .or_else(|| self.available_models.first())
                .map(|item| item.model.clone())
                .unwrap_or_else(|| super::DEFAULT_MODEL.to_owned())
        }
    }

    /// Keeps a reasoning-effort selection valid for the chosen model.
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
                .unwrap_or_else(|| super::DEFAULT_THINKING_VARIANT.to_owned())
        }
    }

    /// Finds the reasoning-effort options for the selected model.
    pub fn thinking_variants_for(&self, model: &str) -> Vec<ThinkingVariantOption> {
        self.available_models
            .iter()
            .find(|item| item.model == model)
            .or_else(|| self.available_models.iter().find(|item| item.is_default))
            .or_else(|| self.available_models.first())
            .map(|item| item.thinking_variants.clone())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(fallback_thinking_variants)
    }
}

/// Returns the pinned fallback Codex client version.
fn default_codex_client_version() -> String {
    DEFAULT_CODEX_CLIENT_VERSION.to_owned()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingVariantOption {
    pub value: String,
    pub description: String,
}

/// Builds the local fallback model catalog.
pub fn fallback_models() -> Vec<AvailableModel> {
    vec![
        fallback_model(super::DEFAULT_MODEL, true),
        fallback_model("gpt-5.4", false),
        fallback_model("gpt-5.4-mini", false),
    ]
}

/// Creates one fallback model entry.
fn fallback_model(model: &str, is_default: bool) -> AvailableModel {
    AvailableModel {
        id: model.to_owned(),
        model: model.to_owned(),
        display_name: model.to_owned(),
        description: String::new(),
        hidden: false,
        is_default,
        input_modalities: default_input_modalities(),
        default_thinking_variant: DEFAULT_THINKING_VARIANT.to_owned(),
        thinking_variants: fallback_thinking_variants(),
    }
}

/// Returns the default text and image input modalities.
fn default_input_modalities() -> Vec<String> {
    vec!["text".to_owned(), "image".to_owned()]
}

/// Returns the fallback reasoning effort value.
fn default_thinking_variant() -> String {
    DEFAULT_THINKING_VARIANT.to_owned()
}

/// Builds the local fallback reasoning-effort options.
pub fn fallback_thinking_variants() -> Vec<ThinkingVariantOption> {
    vec![
        thinking("low", "Fast responses with lighter reasoning"),
        thinking("medium", "Balanced reasoning for everyday tasks"),
        thinking("high", "Greater reasoning depth for complex tasks"),
        thinking("xhigh", "Extra high reasoning depth for complex tasks"),
    ]
}

/// Creates one reasoning-effort option.
fn thinking(value: &str, description: &str) -> ThinkingVariantOption {
    ThinkingVariantOption {
        value: value.to_owned(),
        description: description.to_owned(),
    }
}
