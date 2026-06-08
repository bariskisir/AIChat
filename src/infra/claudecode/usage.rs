//! Claude Code usage-limit fetching from the Anthropic OAuth usage API.

use super::{ANTHROPIC_BETA_META, API_BASE, ClaudeCodeContext, anthropic_headers};
use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Local};
use serde_json::Value;

/// Parsed Claude Code usage limits for the account.
#[derive(Clone, Debug, Default)]
pub struct ClaudeCodeUsage {
    pub five_hour_label: String,
    pub seven_day_label: String,
}

/// Fetches the current Claude Code usage limits.
pub async fn fetch_usage(ctx: &ClaudeCodeContext) -> Result<ClaudeCodeUsage> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{API_BASE}/api/oauth/usage"))
        .headers(anthropic_headers(
            &ctx.access_token,
            "application/json",
            ANTHROPIC_BETA_META,
            false,
        )?)
        .send()
        .await
        .context("Could not reach the Anthropic usage API")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Anthropic usage request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }
    let value: Value = response
        .json()
        .await
        .context("Could not parse Anthropic usage response")?;
    Ok(ClaudeCodeUsage {
        five_hour_label: window_label(value.get("five_hour")),
        seven_day_label: window_label(value.get("seven_day")),
    })
}

/// Formats one usage window (`{utilization, resets_at}`) into a compact label.
fn window_label(window: Option<&Value>) -> String {
    let Some(window) = window.filter(|value| !value.is_null()) else {
        return String::new();
    };
    let utilization = window
        .get("utilization")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let resets = window
        .get("resets_at")
        .and_then(Value::as_str)
        .and_then(format_reset)
        .unwrap_or_default();
    if resets.is_empty() {
        format!("{utilization:.0}%")
    } else {
        format!("{utilization:.0}% · resets {resets}")
    }
}

/// Formats an ISO-8601 reset timestamp into a short label in the local timezone.
fn format_reset(value: &str) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(value).ok()?;
    Some(
        parsed
            .with_timezone(&Local)
            .format("%b %d %H:%M")
            .to_string(),
    )
}
