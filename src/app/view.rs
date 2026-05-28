//! View models and data transfer types for the frontend.

use crate::domain::{AppSettings, AvailableModel, ChatSession};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub status: String,
    pub account: AccountSnapshot,
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
    pub plan: String,
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
    pub extended_thinking: bool,
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
