//! Claude Code account status storage for the local-credential Anthropic provider.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeStatus {
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub five_hour_label: String,
    #[serde(default)]
    pub seven_day_label: String,
    #[serde(default)]
    pub error: String,
}
