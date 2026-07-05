//! Antigravity project, version, and usage-limit fetching.

use super::{DEFAULT_CLI_VERSION, API_BASE, antigravity_headers};
use anyhow::{Context, Result};

/// Project information returned from loadCodeAssist.
#[derive(Clone, Debug)]
pub struct ProjectInfo {
    pub project_id: String,
    pub tier_id: String,
}

/// Fetches the latest antigravity CLI version tag from GitHub.
pub async fn fetch_cli_version() -> String {
    let url = "https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest";
    let client = reqwest::Client::new();
    let Ok(response) = client
        .get(url)
        .header("User-Agent", "ai-chat")
        .header("Accept", "application/json")
        .send()
        .await
    else {
        return DEFAULT_CLI_VERSION.to_owned();
    };
    if !response.status().is_success() {
        return DEFAULT_CLI_VERSION.to_owned();
    }
    let Ok(json) = response.json::<serde_json::Value>().await else {
        return DEFAULT_CLI_VERSION.to_owned();
    };
    json.get("tag_name")
        .and_then(|v| v.as_str())
        .map(|v| v.trim_start_matches('v').to_owned())
        .unwrap_or_else(|| DEFAULT_CLI_VERSION.to_owned())
}

/// Fetches the cloudaicompanion project ID and tier from the API.
pub async fn fetch_project(
    access_token: &str,
    user_agent: &str,
) -> Result<ProjectInfo> {
    let url = format!("{API_BASE}/v1internal:loadCodeAssist");
    let body = serde_json::json!({ "metadata": { "ideType": "ANTIGRAVITY" } });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .headers(antigravity_headers(access_token, user_agent)?)
        .json(&body)
        .send()
        .await
        .context("Failed to fetch antigravity project ID")?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_owned());
        return Err(anyhow::anyhow!(
            "Antigravity project fetch returned HTTP {status}: {}",
            truncate_body(&text)
        ));
    }
    let json: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse antigravity project response")?;
    let project_id = json
        .get("cloudaicompanionProject")
        .and_then(|v| v.as_str())
        .context("Antigravity project response missing 'cloudaicompanionProject'")?
        .to_owned();
    let tier_id = json
        .pointer("/currentTier/id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();
    Ok(ProjectInfo { project_id, tier_id })
}

/// Fetches usage quota summary from the API.
pub async fn fetch_usage(
    access_token: &str,
    project_id: &str,
    user_agent: &str,
) -> Result<String> {
    let url = format!("{API_BASE}/v1internal:retrieveUserQuotaSummary");
    let body = serde_json::json!({ "project": project_id });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .headers(antigravity_headers(access_token, user_agent)?)
        .json(&body)
        .send()
        .await
        .context("Failed to fetch antigravity usage")?;
    if !response.status().is_success() {
        return Ok(String::new());
    }
    let json: serde_json::Value = response
        .json()
        .await
        .unwrap_or_default();
    let mut labels = Vec::new();
    if let Some(groups) = json.get("groups").and_then(|v| v.as_array()) {
        for group in groups {
            let group_name = group
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or("Models");
            if let Some(buckets) = group.get("buckets").and_then(|v| v.as_array()) {
                for bucket in buckets {
                    let remaining = bucket
                        .get("remainingFraction")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(1.0);
                    let window = bucket
                        .get("window")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let used_percent = ((1.0 - remaining) * 100.0).clamp(0.0, 100.0) as u32;
                    let label = if window.is_empty() {
                        format!("{group_name}: {used_percent}% used")
                    } else {
                        format!("{group_name} ({window}): {used_percent}% used")
                    };
                    labels.push(label);
                }
            }
        }
    }
    Ok(labels.join(" | "))
}

/// Limits error response bodies for display in the UI.
fn truncate_body(value: &str) -> String {
    let limit = 800;
    if value.len() > limit {
        format!("{}...", &value[..limit])
    } else {
        value.to_owned()
    }
}
