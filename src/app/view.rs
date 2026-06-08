//! View models and data transfer types for the frontend.

use crate::domain::{
    AppSettings, AvailableModel, ChatSession, ProviderConfig, ThinkingVariantOption,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub status: String,
    pub account: AccountSnapshot,
    pub claude_account: ClaudeAccountSnapshot,
    pub claude_code_account: ClaudeCodeAccountSnapshot,
    pub providers: ProviderSnapshot,
    pub catalog: CatalogSnapshot,
    pub sessions: Vec<ChatSession>,
    pub active_session: ChatSession,
    pub is_generating: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub logged_in: bool,
    pub email: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccountSnapshot {
    pub logged_in: bool,
    pub email: String,
    pub plan: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeAccountSnapshot {
    pub available: bool,
    pub plan: String,
    pub five_hour_label: String,
    pub seven_day_label: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub configured: bool,
    pub providers: Vec<ProviderConfig>,
    pub active_provider_id: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub models: Vec<AvailableModel>,
    pub thinking_variants: Vec<ThinkingVariantOption>,
    pub verbosity_supported: bool,
    pub default_verbosity: String,
    pub limit_label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub model: String,
    pub compact_mode: bool,
    pub reasoning_effort: String,
    #[serde(default = "default_thinking_variant")]
    pub thinking_variant: String,
    #[serde(default = "default_verbosity_setting")]
    pub verbosity: String,
    #[serde(default = "default_extended_thinking")]
    pub extended_thinking: bool,
    #[serde(default = "default_claude_effort")]
    pub claude_effort: String,
    pub always_on_top: bool,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    #[serde(default)]
    pub sidebar_width: Option<u32>,
    #[serde(default = "default_show_footer")]
    pub show_footer: bool,
    #[serde(default = "default_show_info_bar")]
    pub show_info_bar: bool,
    #[serde(default)]
    pub title_gen_model: String,
}

/// Returns the fallback Codex thinking setting for older frontends.
fn default_thinking_variant() -> String {
    crate::domain::DEFAULT_THINKING_VARIANT.to_owned()
}

/// Returns the fallback Codex verbosity setting for older frontends.
fn default_verbosity_setting() -> String {
    crate::domain::default_verbosity_setting()
}

/// Returns the fallback Claude extended-thinking setting for older frontends.
fn default_extended_thinking() -> bool {
    crate::domain::default_extended_thinking()
}

/// Returns the fallback Claude effort setting for older frontends.
fn default_claude_effort() -> String {
    crate::domain::default_claude_effort()
}

/// Returns the default show-footer setting for older frontends.
fn default_show_footer() -> bool {
    true
}

/// Returns the default show-info-bar setting for older frontends.
fn default_show_info_bar() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub text: String,
    #[serde(default)]
    pub image_data_urls: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub custom_headers: String,
}
