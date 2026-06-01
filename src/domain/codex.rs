//! Codex-specific auth, catalog, thinking, and verbosity models.

use super::messages::{
    DESC_THINKING_HIGH, DESC_THINKING_LOW, DESC_THINKING_MEDIUM, DESC_THINKING_XHIGH,
    LABEL_THINKING_HIGH, LABEL_THINKING_LOW, LABEL_THINKING_MEDIUM, LABEL_THINKING_XHIGH,
};
use super::{
    AvailableModel, DEFAULT_CODEX_CLIENT_VERSION, DEFAULT_CODEX_MODEL, DEFAULT_THINKING_VARIANT,
    DEFAULT_VERBOSITY, ThinkingVariantOption,
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

impl AuthStorage {
    /// Reports whether a ChatGPT token is available.
    pub fn is_signed_in(&self) -> bool {
        !self.access_token.is_empty() || !self.refresh_token.is_empty()
    }
}

/// Returns the pinned fallback Codex client version.
pub(crate) fn default_codex_client_version() -> String {
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
        claude_thinking_type: String::new(),
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
        thinking(LABEL_THINKING_LOW, DESC_THINKING_LOW),
        thinking(LABEL_THINKING_MEDIUM, DESC_THINKING_MEDIUM),
        thinking(LABEL_THINKING_HIGH, DESC_THINKING_HIGH),
        thinking(LABEL_THINKING_XHIGH, DESC_THINKING_XHIGH),
    ]
}

/// Reports whether a value is one of the supported verbosity levels.
pub(crate) fn is_verbosity_level(value: &str) -> bool {
    matches!(
        value,
        LABEL_THINKING_LOW | LABEL_THINKING_MEDIUM | LABEL_THINKING_HIGH
    )
}

/// Creates one thinking option.
fn thinking(value: &str, description: &str) -> ThinkingVariantOption {
    ThinkingVariantOption {
        value: value.to_owned(),
        description: description.to_owned(),
    }
}
