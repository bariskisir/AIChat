//! Antigravity model catalog fetching from the Google Cloud Code API.

use super::{antigravity_headers, AntigravityContext, API_BASE};
use crate::domain::{AvailableModel, ThinkingVariantOption};
use crate::domain::messages::{
    DESC_THINKING_HIGH, DESC_THINKING_LOW, DESC_THINKING_MEDIUM, LABEL_THINKING_HIGH,
    LABEL_THINKING_LOW, LABEL_THINKING_MEDIUM,
};
use anyhow::{Context, Result};
use serde_json::Value;

/// Fetches the antigravity model list from Google's API.
pub async fn fetch_models(ctx: &AntigravityContext) -> Result<Vec<AvailableModel>> {
    let url = format!("{API_BASE}/v1internal:fetchAvailableModels");
    let body = serde_json::json!({ "project": &ctx.project_id });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .headers(antigravity_headers(&ctx.access_token, &ctx.user_agent)?)
        .json(&body)
        .send()
        .await
        .context("Failed to fetch antigravity models")?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_owned());
        return Err(anyhow::anyhow!(
            "Antigravity fetch models returned HTTP {status}: {}",
            truncate_body(&text)
        ));
    }
    let json: Value = response
        .json()
        .await
        .context("Failed to parse antigravity models response")?;
    let default_model_id = json
        .get("defaultAgentModelId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let models_obj = json
        .get("models")
        .and_then(Value::as_object)
        .context("Antigravity models response missing 'models' field")?;
    let mut models = Vec::new();
    for (model_id, model_info) in models_obj {
        if let Some(model) = parse_model(model_id, model_info, default_model_id) {
            models.push(model);
        }
    }
    if models.is_empty() {
        return Err(anyhow::anyhow!(
            "Antigravity returned an empty model list."
        ));
    }
    Ok(models)
}

/// Converts one model entry from the API response into an AvailableModel.
fn parse_model(model_id: &str, info: &Value, default_model_id: &str) -> Option<AvailableModel> {
    let display_name = info
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(model_id)
        .to_owned();
    let supports_images = info
        .get("supportsImages")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let supports_thinking = info
        .get("supportsThinking")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let recommended = info
        .get("recommended")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let is_internal = info
        .get("isInternal")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if is_internal {
        return None;
    }
    let mut input_modalities = vec!["text".to_owned()];
    if supports_images {
        input_modalities.push("image".to_owned());
    }
    let thinking_variants = if supports_thinking {
        vec![
            ThinkingVariantOption {
                value: LABEL_THINKING_LOW.to_owned(),
                description: DESC_THINKING_LOW.to_owned(),
            },
            ThinkingVariantOption {
                value: LABEL_THINKING_MEDIUM.to_owned(),
                description: DESC_THINKING_MEDIUM.to_owned(),
            },
            ThinkingVariantOption {
                value: LABEL_THINKING_HIGH.to_owned(),
                description: DESC_THINKING_HIGH.to_owned(),
            },
        ]
    } else {
        Vec::new()
    };
    let default_thinking_variant = if supports_thinking {
        LABEL_THINKING_HIGH.to_owned()
    } else {
        LABEL_THINKING_LOW.to_owned()
    };
    Some(AvailableModel {
        provider_id: String::new(),
        provider_name: String::new(),
        model: model_id.to_string(),
        display_name,
        description: String::new(),
        hidden: false,
        is_default: model_id == default_model_id || recommended && default_model_id.is_empty(),
        input_modalities,
        default_thinking_variant,
        thinking_variants,
        support_verbosity: false,
        default_verbosity: LABEL_THINKING_HIGH.to_owned(),
        claude_thinking_type: String::new(),
    })
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
