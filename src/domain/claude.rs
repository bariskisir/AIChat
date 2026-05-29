//! Claude-specific auth storage for Claude.ai web integration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCredential {
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub session_key: String,
    #[serde(default)]
    pub cookies: HashMap<String, String>,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub error: String,
}

impl ClaudeCredential {
    /// Reports whether stored credentials are enough to call Claude web APIs.
    pub fn is_signed_in(&self) -> bool {
        !self.org_id.is_empty() && !self.session_key.is_empty()
    }
}
