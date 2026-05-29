//! View models and data transfer types for the frontend.

use crate::domain::{AppSettings, AvailableModel, ChatSession, ProviderConfig};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub status: String,
    pub providers: ProviderSnapshot,
    pub catalog: CatalogSnapshot,
    pub sessions: Vec<ChatSession>,
    pub active_session: ChatSession,
    pub is_generating: bool,
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
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub model: String,
    pub compact_mode: bool,
    pub reasoning_effort: String,
    pub always_on_top: bool,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    #[serde(default)]
    pub sidebar_width: Option<u32>,
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
