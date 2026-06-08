//! Claude Code model catalog fetching and parsing from the Anthropic `/v1/models` API.

use super::{ANTHROPIC_BETA_META, API_BASE, ClaudeCodeContext, anthropic_headers};
use crate::domain::messages::{
    LABEL_THINKING_HIGH, LABEL_THINKING_LOW, LABEL_THINKING_MAX, LABEL_THINKING_MEDIUM,
    LABEL_THINKING_XHIGH,
};
use crate::domain::{AvailableModel, ThinkingVariantOption};
use anyhow::{Context, Result, anyhow};
use serde_json::Value;

/// Ordered effort levels recognized by the Anthropic effort capability.
const EFFORT_LEVELS: [&str; 5] = [
    LABEL_THINKING_LOW,
    LABEL_THINKING_MEDIUM,
    LABEL_THINKING_HIGH,
    LABEL_THINKING_XHIGH,
    LABEL_THINKING_MAX,
];

/// Fetches the Claude Code model catalog from the Anthropic API.
pub async fn fetch_models(ctx: &ClaudeCodeContext) -> Result<Vec<AvailableModel>> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{API_BASE}/v1/models"))
        .headers(anthropic_headers(
            &ctx.access_token,
            "application/json",
            ANTHROPIC_BETA_META,
            false,
        )?)
        .send()
        .await
        .context("Could not reach the Anthropic models API")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Anthropic models request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }
    let value: Value = response
        .json()
        .await
        .context("Could not parse Anthropic models response")?;
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Anthropic models response did not contain a model list"))?;
    let mut models: Vec<AvailableModel> = items
        .iter()
        .filter_map(parse_model)
        .collect();
    if models.is_empty() {
        return Err(anyhow!("No models found in Anthropic models response"));
    }
    if let Some(first) = models.first_mut() {
        first.is_default = true;
    }
    Ok(models)
}

/// Converts one Anthropic model entry into a catalog model.
fn parse_model(value: &Value) -> Option<AvailableModel> {
    let model = value.get("id").and_then(Value::as_str)?.to_owned();
    let display_name = value
        .get("display_name")
        .and_then(Value::as_str)
        .unwrap_or(&model)
        .to_owned();
    let capabilities = value.get("capabilities");
    let effort_levels = supported_effort_levels(capabilities);
    let supports_image = capabilities
        .and_then(|caps| caps.pointer("/image_input/supported"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let input_modalities = if supports_image {
        vec!["text".to_owned(), "image".to_owned()]
    } else {
        vec!["text".to_owned()]
    };
    let (claude_thinking_type, thinking_variants, default_thinking_variant) =
        if effort_levels.is_empty() {
            ("none".to_owned(), Vec::new(), String::new())
        } else {
            let default = if effort_levels.iter().any(|level| level == LABEL_THINKING_HIGH) {
                LABEL_THINKING_HIGH.to_owned()
            } else {
                effort_levels.last().cloned().unwrap_or_default()
            };
            let variants = effort_levels
                .iter()
                .map(|level| ThinkingVariantOption {
                    value: level.clone(),
                    description: effort_description(level),
                })
                .collect();
            ("effort_and_mode".to_owned(), variants, default)
        };
    Some(AvailableModel {
        provider_id: String::new(),
        provider_name: String::new(),
        model,
        display_name,
        description: String::new(),
        hidden: false,
        is_default: false,
        input_modalities,
        default_thinking_variant,
        thinking_variants,
        support_verbosity: false,
        default_verbosity: LABEL_THINKING_HIGH.to_owned(),
        claude_thinking_type,
    })
}

/// Collects the supported effort levels for a model in canonical order.
fn supported_effort_levels(capabilities: Option<&Value>) -> Vec<String> {
    let Some(effort) = capabilities.and_then(|caps| caps.get("effort")) else {
        return Vec::new();
    };
    if effort.get("supported").and_then(Value::as_bool) != Some(true) {
        return Vec::new();
    }
    EFFORT_LEVELS
        .iter()
        .filter(|level| {
            effort
                .pointer(&format!("/{level}/supported"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .map(|level| (*level).to_owned())
        .collect()
}

/// Returns a short description for an effort level.
fn effort_description(level: &str) -> String {
    match level {
        LABEL_THINKING_LOW => "Fast responses with lighter reasoning",
        LABEL_THINKING_MEDIUM => "Balanced reasoning for everyday tasks",
        LABEL_THINKING_HIGH => "Greater reasoning depth for complex tasks",
        LABEL_THINKING_XHIGH => "Extra high reasoning depth for complex tasks",
        LABEL_THINKING_MAX => "Maximum reasoning depth",
        _ => "",
    }
    .to_owned()
}
