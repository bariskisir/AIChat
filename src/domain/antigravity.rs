//! Antigravity (Gemini Code Assist) account status kept in memory only.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityStatus {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub cli_version: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub limit_label: String,
    #[serde(default)]
    pub error: String,
}
