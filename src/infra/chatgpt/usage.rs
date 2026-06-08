//! ChatGPT usage limit fetching and label formatting.

use super::{AccessContext, CHATGPT_USAGE_URL, chatgpt_headers};
use anyhow::{Context, Result, anyhow};
use chrono::{Local, Utc};
use serde_json::Value;

/// Fetches the account usage limits and formats a compact label.
pub async fn fetch_usage_limit_label(access: &AccessContext) -> Result<String> {
    let client = reqwest::Client::new();
    let response = client
        .get(CHATGPT_USAGE_URL)
        .headers(chatgpt_headers(access, "application/json", false)?)
        .send()
        .await
        .context("Could not fetch ChatGPT usage limits")?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "ChatGPT limit check failed with status {}",
            response.status()
        ));
    }
    Ok(compact_usage_label(&response.json::<Value>().await?))
}

/// Combines plan and rate-limit details into one display label.
fn compact_usage_label(payload: &Value) -> String {
    let plan = extract_plan_name(payload).unwrap_or_default();
    let limit = payload
        .get("rate_limit")
        .and_then(format_rate_limit)
        .or_else(|| {
            payload
                .get("additional_rate_limits")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items
                        .iter()
                        .find_map(|i| i.get("rate_limit").and_then(format_rate_limit))
                })
        });
    match (plan.trim(), limit) {
        ("", Some(l)) => l,
        ("", None) => String::new(),
        (p, Some(l)) => format!("{p}, {l}"),
        (p, None) => p.to_owned(),
    }
}

/// Formats the available rate-limit windows from a usage payload.
fn format_rate_limit(rate_limit: &Value) -> Option<String> {
    let mut windows = ["primary_window", "secondary_window"]
        .into_iter()
        .filter_map(|key| rate_limit.get(key))
        .filter_map(format_rate_limit_window)
        .collect::<Vec<_>>();
    windows.sort_by_key(|w| std::cmp::Reverse(w.minutes));
    let label = windows
        .into_iter()
        .map(|w| w.label)
        .collect::<Vec<_>>()
        .join(", ");
    if label.is_empty() { None } else { Some(label) }
}

struct UsageWindowLabel {
    minutes: i64,
    label: String,
}

/// Formats one usage-limit window.
fn format_rate_limit_window(window: &Value) -> Option<UsageWindowLabel> {
    let used_percent = number_at(window, "used_percent").unwrap_or(0.0).clamp(0.0, 100.0);
    let percent = format_percent(used_percent);
    let minutes = int_at(window, "limit_window_seconds").map(|v| (v + 59) / 60)?;
    if minutes <= 0 {
        return None;
    }
    let mut label = format!("{}: {percent}%", format_window(minutes));
    if let Some(reset_at) = reset_timestamp(window)
        && let Some(time) = format_reset_time(reset_at)
    {
        label.push_str(&format!(" resets {time}"));
    }
    Some(UsageWindowLabel { minutes, label })
}

/// Formats a reset timestamp with a stable local date and time.
fn format_reset_time(reset_at: i64) -> Option<String> {
    let reset = chrono::DateTime::from_timestamp(reset_at, 0)?.with_timezone(&Local);
    Some(reset.format("%d.%m.%Y %H:%M").to_string())
}

/// Finds the plan name in a usage payload.
fn extract_plan_name(value: &Value) -> Option<String> {
    for key in [
        "plan",
        "plan_name",
        "plan_type",
        "subscription_plan",
        "subscription_tier",
        "account_plan",
        "tier",
    ] {
        if let Some(plan) = normalize_plan_name(value.get(key).and_then(Value::as_str)) {
            return Some(plan);
        }
    }
    find_plan_name(value, 0)
}

/// Recursively searches nested usage data for a plan label.
fn find_plan_name(value: &Value, depth: usize) -> Option<String> {
    if depth > 4 {
        return None;
    }
    match value {
        Value::String(text) => normalize_plan_name(Some(text)),
        Value::Array(items) => items.iter().find_map(|i| find_plan_name(i, depth + 1)),
        Value::Object(map) => map.iter().find_map(|(key, nested)| {
            let k = key.to_lowercase();
            if k.contains("plan") || k.contains("tier") || k.contains("subscription") {
                find_plan_name(nested, depth + 1)
            } else {
                None
            }
        }),
        _ => None,
    }
}

/// Normalizes raw plan text into a display label.
fn normalize_plan_name(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    for plan in [
        "free",
        "plus",
        "pro",
        "team",
        "business",
        "enterprise",
        "edu",
    ] {
        if normalized == plan || normalized.contains(plan) {
            return Some(format!("{}{}", plan[..1].to_uppercase(), &plan[1..]));
        }
    }
    if normalized.contains("plan")
        || normalized.contains("tier")
        || normalized.contains("subscription")
    {
        return Some(prettify_label(&normalized));
    }
    None
}

/// Reads a floating-point number from a JSON field.
fn number_at(value: &Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .or_else(|| value.get(key).and_then(Value::as_str)?.parse::<f64>().ok())
}

/// Reads an integer from a JSON field.
fn int_at(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .or_else(|| value.get(key).and_then(Value::as_str)?.parse::<i64>().ok())
}

/// Resolves an absolute reset timestamp from usage-limit fields.
fn reset_timestamp(value: &Value) -> Option<i64> {
    let absolute = [
        "reset_at",
        "resets_at",
        "resetAt",
        "resetsAt",
        "reset_timestamp",
        "resetTimestamp",
    ]
    .into_iter()
    .find_map(|key| int_at(value, key))
    .map(|ts| if ts > 10_000_000_000 { ts / 1000 } else { ts })
    .filter(|ts| *ts > 0);
    if absolute.is_some() {
        return absolute;
    }
    [
        "reset_after_seconds",
        "resetAfterSeconds",
        "seconds_until_reset",
        "secondsUntilReset",
    ]
    .into_iter()
    .find_map(|key| int_at(value, key))
    .filter(|s| *s > 0)
    .map(|s| Utc::now().timestamp() + s)
}

/// Formats a percentage without unnecessary decimals.
fn format_percent(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        format!("{value:.1}")
    }
}

/// Formats a usage window duration in minutes, hours, or days.
fn format_window(minutes: i64) -> String {
    if minutes % 1440 == 0 {
        format!("{}d", minutes / 1440)
    } else if minutes % 60 == 0 {
        format!("{}h", minutes / 60)
    } else {
        format!("{minutes}m")
    }
}

/// Converts machine-style labels into title-cased display text.
fn prettify_label(value: &str) -> String {
    value
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
