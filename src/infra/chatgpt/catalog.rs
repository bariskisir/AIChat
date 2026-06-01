//! ChatGPT model catalog fetching and normalization.

use super::{AccessContext, CHATGPT_MODELS_URL, chatgpt_headers, fetch_codex_client_version};
use crate::domain::{
    AvailableModel, CatalogStorage, DEFAULT_CODEX_MODEL, DEFAULT_THINKING_VARIANT,
    DEFAULT_VERBOSITY, ThinkingVariantOption, fallback_models, fallback_thinking_variants,
};
use anyhow::{Context, Result, anyhow};
use serde_json::Value;

/// Fetches and normalizes the ChatGPT model catalog.
pub async fn fetch_model_catalog(access: &AccessContext) -> Result<CatalogStorage> {
    let client_version = fetch_codex_client_version().await;
    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{CHATGPT_MODELS_URL}?client_version={}",
            urlencoding::encode(&client_version)
        ))
        .headers(chatgpt_headers(access, "application/json", false)?)
        .send()
        .await
        .context("Could not fetch ChatGPT models")?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "ChatGPT models check failed with status {}",
            response.status()
        ));
    }
    Ok(CatalogStorage {
        available_models: normalize_models_payload(response.json::<Value>().await?),
        codex_client_version: client_version,
        chatgpt_limit_label: String::new(),
    })
}

/// Normalizes a ChatGPT models payload into catalog entries.
fn normalize_models_payload(payload: Value) -> Vec<AvailableModel> {
    let mut models = payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(normalize_model)
                .filter(|model| !is_auto_review_model(model))
                .collect::<Vec<AvailableModel>>()
        })
        .unwrap_or_default();
    models.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    if models.is_empty() {
        return fallback_models();
    }
    if !models.iter().any(|model| model.is_default)
        && let Some(first) = models.iter_mut().find(|model| !model.hidden)
    {
        first.is_default = true;
    }
    models
}

/// Excludes ChatGPT's internal Codex auto-review model from user-facing catalogs.
fn is_auto_review_model(model: &AvailableModel) -> bool {
    let model_id = model.model.to_lowercase();
    let display_name = model.display_name.to_lowercase();
    model_id.contains("auto-review")
        || model_id.contains("auto_review")
        || display_name.contains("auto review")
}

/// Normalizes one ChatGPT model record.
fn normalize_model(value: &Value) -> Option<AvailableModel> {
    let model = value
        .get("slug")
        .or_else(|| value.get("model"))
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)?
        .trim()
        .to_owned();
    if model.is_empty() {
        return None;
    }
    let thinking_variants = value
        .get("supported_reasoning_levels")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let effort = item.get("effort").and_then(Value::as_str)?.trim();
                    if effort.is_empty() {
                        return None;
                    }
                    Some(ThinkingVariantOption {
                        value: effort.to_owned(),
                        description: item
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or(effort)
                            .to_owned(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(fallback_thinking_variants);
    Some(AvailableModel {
        provider_id: String::new(),
        provider_name: String::new(),
        model: model.clone(),
        display_name: value
            .get("display_name")
            .or_else(|| value.get("displayName"))
            .and_then(Value::as_str)
            .unwrap_or(&model)
            .to_owned(),
        description: value
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        hidden: value
            .get("hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || value.get("visibility").and_then(Value::as_str) == Some("hide"),
        is_default: value
            .get("is_default")
            .and_then(Value::as_bool)
            .unwrap_or(model == DEFAULT_CODEX_MODEL),
        input_modalities: value
            .get("input_modalities")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| vec!["text".to_owned(), "image".to_owned()]),
        default_thinking_variant: value
            .get("default_reasoning_level")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_THINKING_VARIANT)
            .to_owned(),
        thinking_variants,
        support_verbosity: value
            .get("support_verbosity")
            .or_else(|| value.get("supportVerbosity"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
        default_verbosity: value
            .get("default_verbosity")
            .or_else(|| value.get("defaultVerbosity"))
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "low" | "medium" | "high"))
            .unwrap_or(DEFAULT_VERBOSITY)
            .to_owned(),
        claude_thinking_type: String::new(),
    })
}
