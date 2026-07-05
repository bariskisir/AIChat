//! GitHub release update checker.

use anyhow::{Context, Result, anyhow};
use serde_json::Value;

pub const UPDATE_URL: &str = "https://github.com/bariskisir/AIChat/releases/latest";

/// Shows a Windows toast notification that opens the releases page on click.
pub fn show_update_notification(version: &str) {
    use notify_rust::{Notification, NotificationResponse};

    let mut notification = Notification::new();
    notification
        .summary("AI Chat")
        .body(&format!("AI Chat {version} is available — click to download"))
        .appname("AI Chat");

    if let Ok(handle) = notification.show() {
        std::thread::spawn(move || {
            let _ = handle.wait_for_response(|response: &NotificationResponse| {
                if matches!(response, NotificationResponse::Default)
                    || matches!(response, NotificationResponse::Action(_))
                {
                    let _ = crate::infra::shell::open_url(UPDATE_URL);
                }
            });
        });
    }
}

pub struct UpdateCheckResult {
    pub has_update: bool,
    pub latest_version: String,
    pub error_message: String,
}

/// Checks GitHub releases for a newer version than the current one.
pub async fn check_for_update(current_version: &str) -> UpdateCheckResult {
    match check_github_release(current_version).await {
        Ok(result) => result,
        Err(error) => UpdateCheckResult {
            has_update: false,
            latest_version: String::new(),
            error_message: error.to_string(),
        },
    }
}

async fn check_github_release(current_version: &str) -> Result<UpdateCheckResult> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/repos/bariskisir/AIChat/releases/latest")
        .header("User-Agent", "AIChat")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("Could not reach GitHub releases")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "GitHub releases request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }
    let value: Value = response
        .json()
        .await
        .context("Could not parse GitHub release response")?;
    let tag_name = value
        .get("tag_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let latest_version = tag_name.trim_start_matches('v').to_owned();
    if latest_version.is_empty() {
        return Err(anyhow!("Could not determine latest release version."));
    }
    let has_update = compare_versions(&latest_version, current_version);
    Ok(UpdateCheckResult {
        has_update,
        latest_version,
        error_message: String::new(),
    })
}

/// Compares two semver-like strings and returns true when `latest` > `current`.
fn compare_versions(latest: &str, current: &str) -> bool {
    let latest_parts: Vec<u32> = latest
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect();
    let current_parts: Vec<u32> = current
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect();
    if latest_parts.is_empty() || current_parts.is_empty() {
        return false;
    }
    let max_len = latest_parts.len().max(current_parts.len());
    for i in 0..max_len {
        let latest = latest_parts.get(i).copied().unwrap_or(0);
        let current = current_parts.get(i).copied().unwrap_or(0);
        if latest > current {
            return true;
        }
        if latest < current {
            return false;
        }
    }
    false
}
