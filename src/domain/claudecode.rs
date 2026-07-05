//! Claude Code account status storage for the local-credential Anthropic provider.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeStatus {
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub limit_label: String,
    #[serde(default)]
    pub error: String,
}
