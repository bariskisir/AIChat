//! Claude.ai REST API client — cookie-based auth, SSE streaming.
//!
//! Endpoints (reverse-engineered from claude.ai web app):
//!   POST /api/organizations/{org_id}/chat_conversations          — create chat
//!   POST /api/organizations/{org_id}/chat_conversations/{id}/completion  — send message (SSE)
//!   DELETE /api/organizations/{org_id}/chat_conversations/{id}   — delete chat
//! Auth: Cookie header with sessionKey

use crate::domain::{AvailableModel, ClaudeCredential};
use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderValue};
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use std::collections::HashSet;

const URL_BASE: &str = "https://claude.ai";

#[derive(Clone, Debug)]
pub struct ClaudeContext {
    pub org_id: String,
    pub plan: String,
    pub cookies: String,
}

impl ClaudeContext {
    /// Builds an authenticated Claude web context from stored credentials.
    pub fn from_credential(cred: &ClaudeCredential) -> Self {
        let cookies = cred
            .cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        Self {
            org_id: cred.org_id.clone(),
            plan: cred.plan.clone(),
            cookies,
        }
    }
}

/// Builds browser-like headers used by Claude web endpoints.
fn claude_headers(ctx: &ClaudeContext, accept: &str, with_json: bool) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_str(accept)?);
    if with_json {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    headers.insert("Cookie", HeaderValue::from_str(&ctx.cookies)?);
    headers.insert("User-Agent", HeaderValue::from_static(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    ));
    headers.insert("Origin", HeaderValue::from_static("https://claude.ai"));
    headers.insert("Referer", HeaderValue::from_static("https://claude.ai/"));
    Ok(headers)
}

/// Creates a new conversation on claude.ai. Returns true on 201 Created.
pub async fn create_conversation(ctx: &ClaudeContext, conv_id: &str, model: &str) -> Result<bool> {
    let client = reqwest::Client::new();
    let url = format!(
        "{URL_BASE}/api/organizations/{}/chat_conversations",
        ctx.org_id
    );
    let body = serde_json::json!({"name": "", "model": model, "uuid": conv_id});
    let resp = client
        .post(&url)
        .headers(claude_headers(ctx, "application/json", true)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("Claude API connection error: {e}"))?;
    Ok(resp.status().as_u16() == 201)
}

/// Deletes a conversation on claude.ai.
pub async fn delete_conversation(ctx: &ClaudeContext, conv_id: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!(
        "{URL_BASE}/api/organizations/{}/chat_conversations/{conv_id}",
        ctx.org_id
    );
    let _ = client
        .delete(&url)
        .headers(claude_headers(ctx, "application/json", false)?)
        .send()
        .await;
    Ok(())
}

/// Fetches the Claude bootstrap payload that contains account and model metadata.
pub async fn fetch_bootstrap_json(ctx: &ClaudeContext) -> Result<String> {
    let client = reqwest::Client::new();
    let url = format!(
        "{URL_BASE}/edge-api/bootstrap/{}/app_start?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false",
        ctx.org_id
    );
    let response = client
        .get(&url)
        .headers(claude_headers(ctx, "application/json", false)?)
        .header("anthropic-client-platform", "web_claude_ai")
        .header("anthropic-client-version", "1.0.0")
        .header(
            "anthropic-device-id",
            cookie_value(&ctx.cookies, "anthropic-device-id").unwrap_or_default(),
        )
        .header(
            "anthropic-anonymous-id",
            cookie_value(&ctx.cookies, "ajs_anonymous_id").unwrap_or_default(),
        )
        .header(
            "x-activity-session-id",
            cookie_value(&ctx.cookies, "activitySessionId").unwrap_or_default(),
        )
        .send()
        .await
        .map_err(|e| anyhow!("Claude model catalog connection error: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Claude model catalog request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }

    Ok(response.text().await?)
}

/// Parses the signed-in account email and display plan from a bootstrap payload.
pub(crate) fn parse_account_info(json_str: &str) -> (String, String) {
    let Ok(value) = serde_json::from_str::<Value>(json_str) else {
        return (String::new(), String::new());
    };
    let email = value
        .pointer("/account/email_address")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/account/email").and_then(Value::as_str))
        .unwrap_or("")
        .to_owned();
    let tier = current_tier(&value, None).unwrap_or_default();
    let plan = display_plan(&tier);
    (email, plan)
}

/// Parses visible Claude models for the current account tier from bootstrap JSON.
pub(crate) fn parse_model_response_for_plan(
    json_str: &str,
    plan: Option<&str>,
) -> Result<Vec<AvailableModel>> {
    let val: Value = serde_json::from_str(json_str)
        .map_err(|e| anyhow!("Could not parse model catalog response: {e}"))?;

    let plan = plan.map(normalize_plan).filter(|p| !p.is_empty());
    let tier = current_tier(&val, plan.as_deref());
    let tier_allowed_models = tier
        .as_deref()
        .map(|tier| collect_tier_allowed_models(&val, tier))
        .filter(|models| !models.is_empty());
    let mut models = Vec::new();
    collect_model_selector_models(&val, &mut models);
    if models.is_empty() {
        collect_bootstrap_models(&val, &mut models);
    }
    if models.is_empty() {
        let mut candidates = Vec::new();
        collect_model_candidates(&val, "", plan.as_deref(), &mut candidates);
        candidates.sort_by(|left, right| right.score.cmp(&left.score));
        models = candidates
            .into_iter()
            .filter(|candidate| candidate.available)
            .map(|candidate| candidate.model)
            .collect::<Vec<_>>();
    }
    apply_tier_allowlist(&mut models, tier_allowed_models.as_ref());
    dedupe_models(&mut models);

    if models.is_empty() {
        return Err(anyhow!("No models found in model catalog response"));
    }
    Ok(models)
}

/// Resolves the account tier from bootstrap data or an explicit plan override.
fn current_tier(value: &Value, plan: Option<&str>) -> Option<String> {
    if let Some(plan) = plan {
        return Some(tier_name(plan));
    }
    for path in [
        "/account/memberships/0/organization/rate_limit_tier",
        "/account/memberships/0/organization/billing_type",
        "/account/settings/internal_tier_rate_limit_tier",
        "/account/settings/internal_tier_seat_tier",
    ] {
        if let Some(value) = value.pointer(path).and_then(Value::as_str) {
            let tier = tier_name(value);
            if !tier.is_empty() {
                return Some(tier);
            }
        }
    }
    None
}

/// Collects model identifiers allowed for a subscription tier.
fn collect_tier_allowed_models(value: &Value, tier: &str) -> HashSet<String> {
    let mut models = HashSet::new();
    collect_tier_allowed_models_at(value, tier_rank(tier), &mut models);
    models
}

/// Recursively finds Growthbook tier/model allowlist arrays.
fn collect_tier_allowed_models_at(value: &Value, current_rank: i32, models: &mut HashSet<String>) {
    match value {
        Value::Array(items) => {
            if items
                .iter()
                .any(|item| item.get("minimum_tier").is_some() && item.get("model_id").is_some())
            {
                for item in items {
                    let Some(model_id) = item.get("model_id").and_then(Value::as_str) else {
                        continue;
                    };
                    let minimum_tier = item
                        .get("minimum_tier")
                        .and_then(Value::as_str)
                        .map(tier_name)
                        .unwrap_or_else(|| "free".to_owned());
                    if tier_rank(&minimum_tier) <= current_rank {
                        models.insert(model_id.to_owned());
                    }
                }
            }
            for item in items {
                collect_tier_allowed_models_at(item, current_rank, models);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_tier_allowed_models_at(item, current_rank, models);
            }
        }
        _ => {}
    }
}

/// Marks catalog models hidden when they are not allowed for the current tier.
fn apply_tier_allowlist(models: &mut [AvailableModel], allowed: Option<&HashSet<String>>) {
    let Some(allowed) = allowed else {
        return;
    };
    for model in models {
        if !allowed.contains(&model.model) {
            model.hidden = true;
        }
    }
}

/// Extracts the primary chat model selector entries from bootstrap JSON.
fn collect_model_selector_models(value: &Value, models: &mut Vec<AvailableModel>) {
    let Some(configs) = value.get("model_selector_config").and_then(Value::as_array) else {
        return;
    };
    let Some(chat_config) = configs
        .iter()
        .find(|config| config.get("id").and_then(Value::as_str) == Some("chat"))
    else {
        return;
    };
    let Some(items) = chat_config.get("models").and_then(Value::as_array) else {
        return;
    };

    for item in items {
        if let Some(model) = parse_selector_model(item) {
            models.push(model);
        }
    }
}

/// Converts one model selector entry into the app's catalog model type.
fn parse_selector_model(value: &Value) -> Option<AvailableModel> {
    let model = string_field(value, &["id", "model"])?;
    if !model.starts_with("claude-") {
        return None;
    }
    let section = value
        .get("section")
        .and_then(Value::as_str)
        .unwrap_or("main");
    Some(AvailableModel {
        model,
        display_name: string_field(value, &["name", "display_name", "displayName"])
            .unwrap_or_else(|| model_display_fallback(value)),
        description: string_field(value, &["description", "summary", "subtitle"])
            .unwrap_or_default(),
        hidden: section != "main",
    })
}

/// Extracts organization bootstrap model entries when selector config is absent.
fn collect_bootstrap_models(value: &Value, models: &mut Vec<AvailableModel>) {
    let Some(memberships) = value
        .pointer("/account/memberships")
        .and_then(Value::as_array)
    else {
        return;
    };
    for membership in memberships {
        let Some(items) = membership
            .pointer("/organization/claude_ai_bootstrap_models_config")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for item in items {
            if let Some(model) = parse_bootstrap_model(item) {
                models.push(model);
            }
        }
    }
}

/// Converts one organization bootstrap model entry into a catalog model.
fn parse_bootstrap_model(value: &Value) -> Option<AvailableModel> {
    let model = string_field(value, &["model", "id"])?;
    if !model.starts_with("claude-") {
        return None;
    }
    let inactive = bool_field(value, &["inactive"]) == Some(true);
    let overflow = bool_field(value, &["overflow"]) == Some(true);
    Some(AvailableModel {
        model,
        display_name: string_field(value, &["name", "display_name", "displayName"])
            .unwrap_or_else(|| model_display_fallback(value)),
        description: string_field(value, &["description", "summary", "subtitle"])
            .unwrap_or_default(),
        hidden: inactive || overflow,
    })
}

/// Falls back to a readable model label when Claude omits display text.
fn model_display_fallback(value: &Value) -> String {
    string_field(value, &["model", "id"]).unwrap_or_else(|| "Claude".to_owned())
}

struct ModelCandidate {
    model: AvailableModel,
    available: bool,
    score: i32,
}

/// Recursively collects model-like objects when Claude changes bootstrap shape.
fn collect_model_candidates(
    value: &Value,
    path: &str,
    plan: Option<&str>,
    candidates: &mut Vec<ModelCandidate>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                if let Some(candidate) = parse_model_item(item, path, plan) {
                    candidates.push(candidate);
                }
            }
            for (index, item) in items.iter().enumerate() {
                collect_model_candidates(item, &format!("{path}[{index}]"), plan, candidates);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                if key.starts_with("claude-") {
                    if let Some(mut candidate) = parse_model_item(item, &child_path, plan) {
                        let mut model = candidate.model;
                        if model.model.is_empty() {
                            model.model = key.clone();
                        }
                        candidate.model = model;
                        candidates.push(candidate);
                    } else {
                        candidates.push(ModelCandidate {
                            model: AvailableModel {
                                model: key.clone(),
                                display_name: key.clone(),
                                description: String::new(),
                                hidden: false,
                            },
                            available: true,
                            score: model_path_score(&child_path),
                        });
                    }
                } else if let Some(candidate) = parse_model_item(item, &child_path, plan) {
                    candidates.push(candidate);
                }
                collect_model_candidates(item, &child_path, plan, candidates);
            }
        }
        _ => {}
    }
}

/// Converts an arbitrary JSON object into a model candidate when it looks like one.
fn parse_model_item(value: &Value, path: &str, plan: Option<&str>) -> Option<ModelCandidate> {
    let object = value.as_object()?;
    let model = string_field(value, &["model", "id", "name", "value"])?;
    if !model.starts_with("claude-") {
        return None;
    }
    let display_name = string_field(
        value,
        &["display_name", "displayName", "name", "title", "label"],
    )
    .unwrap_or_else(|| model.clone());
    let description =
        string_field(value, &["description", "summary", "subtitle"]).unwrap_or_default();
    let hidden = object
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Some(ModelCandidate {
        available: model_is_available(value, plan),
        score: model_path_score(path) + availability_score(value),
        model: AvailableModel {
            model,
            display_name,
            description,
            hidden,
        },
    })
}

/// Checks common entitlement flags to determine if a model can be selected.
fn model_is_available(value: &Value, plan: Option<&str>) -> bool {
    if bool_field(
        value,
        &[
            "disabled",
            "isDisabled",
            "is_disabled",
            "locked",
            "isLocked",
            "is_locked",
            "requiresUpgrade",
            "requires_upgrade",
            "requiresSubscription",
            "requires_subscription",
            "upgradeRequired",
            "upgrade_required",
        ],
    ) == Some(true)
    {
        return false;
    }

    for key in [
        "enabled",
        "isEnabled",
        "is_enabled",
        "available",
        "isAvailable",
        "is_available",
        "selectable",
        "isSelectable",
        "is_selectable",
        "entitled",
        "isEntitled",
        "is_entitled",
        "hasAccess",
        "has_access",
        "canUse",
        "can_use",
    ] {
        if bool_field(value, &[key]) == Some(false) {
            return false;
        }
    }

    if let Some(status) = string_field(
        value,
        &[
            "availability",
            "availability_status",
            "availabilityStatus",
            "access",
            "accessStatus",
            "access_status",
            "status",
            "state",
        ],
    )
    .map(|s| s.to_ascii_lowercase())
    {
        if matches!(
            status.as_str(),
            "disabled"
                | "locked"
                | "unavailable"
                | "not_available"
                | "not-entitled"
                | "not_entitled"
                | "requires_upgrade"
                | "upgrade_required"
                | "paywalled"
        ) {
            return false;
        }
    }

    if let Some(plan) = plan
        && let Some(allowed_plans) = string_array_field(
            value,
            &[
                "plans",
                "allowedPlans",
                "allowed_plans",
                "includedPlans",
                "included_plans",
                "availablePlans",
                "available_plans",
                "subscriptionTiers",
                "subscription_tiers",
                "tiers",
            ],
        )
    {
        let allowed = allowed_plans
            .iter()
            .map(|item| normalize_plan(item))
            .any(|item| item == plan);
        if !allowed {
            return false;
        }
    }

    true
}

/// Scores explicit availability markers higher during fallback model discovery.
fn availability_score(value: &Value) -> i32 {
    let mut score = 0;
    for key in [
        "enabled",
        "isEnabled",
        "available",
        "isAvailable",
        "selectable",
        "isSelectable",
        "entitled",
        "isEntitled",
        "hasAccess",
        "canUse",
    ] {
        if bool_field(value, &[key]) == Some(true) {
            score += 20;
        }
    }
    score
}

/// Scores JSON paths that are more likely to describe selectable models.
fn model_path_score(path: &str) -> i32 {
    let path = path.to_ascii_lowercase();
    let mut score = 0;
    for marker in ["available", "enabled", "entitled", "selectable", "allowed"] {
        if path.contains(marker) {
            score += 30;
        }
    }
    for marker in [
        "all_models",
        "allmodels",
        "unavailable",
        "disabled",
        "locked",
    ] {
        if path.contains(marker) {
            score -= 40;
        }
    }
    score
}

/// Reads the first matching string field from a JSON object.
fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str))
        .map(str::to_owned)
}

/// Reads the first matching boolean field from a JSON object.
fn bool_field(value: &Value, names: &[&str]) -> Option<bool> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_bool))
}

/// Reads the first matching string-array field from a JSON object.
fn string_array_field(value: &Value, names: &[&str]) -> Option<Vec<String>> {
    names.iter().find_map(|name| {
        value.get(*name)?.as_array().map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
    })
}

/// Normalizes plan and tier labels for comparisons.
fn normalize_plan(plan: &str) -> String {
    plan.trim()
        .to_ascii_lowercase()
        .replace("claude", "")
        .replace("plan", "")
        .replace([' ', '-', '_'], "")
}

/// Maps Claude-specific tier labels to app-level tier names.
fn tier_name(value: &str) -> String {
    let normalized = normalize_plan(value);
    if normalized.contains("enterprise") {
        "enterprise".to_owned()
    } else if normalized.contains("business") || normalized.contains("team") {
        "team".to_owned()
    } else if normalized.contains("max") {
        "max".to_owned()
    } else if normalized.contains("pro") {
        "pro".to_owned()
    } else if normalized.contains("free") || normalized.contains("default") || normalized.is_empty()
    {
        "free".to_owned()
    } else {
        normalized
    }
}

/// Returns a sortable entitlement rank for Claude account tiers.
fn tier_rank(tier: &str) -> i32 {
    match tier_name(tier).as_str() {
        "free" => 0,
        "pro" => 1,
        "max" => 2,
        "team" => 3,
        "enterprise" => 4,
        _ => 0,
    }
}

/// Converts an internal tier name into display text.
fn display_plan(tier: &str) -> String {
    match tier_name(tier).as_str() {
        "free" => "Free".to_owned(),
        "pro" => "Pro".to_owned(),
        "max" => "Max".to_owned(),
        "team" => "Team".to_owned(),
        "enterprise" => "Enterprise".to_owned(),
        other if !other.is_empty() => other.to_owned(),
        _ => String::new(),
    }
}

/// Removes duplicate model ids while preserving catalog order.
fn dedupe_models(models: &mut Vec<AvailableModel>) {
    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(model.model.clone()));
}

/// Extracts one cookie value from a serialized Cookie header.
fn cookie_value(cookies: &str, name: &str) -> Option<String> {
    cookies
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then(|| value.to_owned()))
}

#[derive(Clone, Debug)]
pub struct ClaudeChatRequest {
    pub prompt: String,
    pub model: String,
    pub extended_thinking: bool,
    pub image_data_urls: Vec<String>,
}

/// Sends a chat message via the Claude API and streams the SSE response.
pub async fn stream_chat_response<F>(
    ctx: &ClaudeContext,
    conv_id: &str,
    request: ClaudeChatRequest,
    mut on_update: F,
) -> Result<String>
where
    F: FnMut(String) + Send,
{
    let human_uuid = uuid_v4();
    let assistant_uuid = uuid_v4();
    let file_ids = upload_image_files(ctx, conv_id, &request.image_data_urls).await?;

    let mut payload = serde_json::json!({
        "prompt": request.prompt,
        "model": request.model,
        "timezone": "Etc/UTC",
        "locale": "en-US",
        "rendering_mode": "messages",
        "turn_message_uuids": {
            "human_message_uuid": human_uuid,
            "assistant_message_uuid": assistant_uuid,
        },
        "attachments": [],
        "files": file_ids,
        "sync_sources": [],
        "thinking_mode": if request.extended_thinking { "extended" } else { "off" },
    });

    if request.extended_thinking {
        payload["thinking_mode"] = serde_json::json!("extended");
        payload["create_conversation_params"] = serde_json::json!({
            "name": "",
            "model": request.model,
            "include_conversation_preferences": true,
            "paprika_mode": "extended",
            "compass_mode": null,
            "is_temporary": false,
            "enabled_imagine": true,
        });
    }

    let url = format!(
        "{URL_BASE}/api/organizations/{}/chat_conversations/{conv_id}/completion",
        ctx.org_id
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .headers(claude_headers(ctx, "text/event-stream", true)?)
        .json(&payload)
        .send()
        .await
        .map_err(|e| anyhow!("Claude API connection error: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Claude API request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }

    let mut text = String::new();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow!("Stream read error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        let lines: Vec<_> = buffer
            .split('\n')
            .map(|l| l.trim_end_matches('\r').to_owned())
            .collect();
        let complete = lines.len().saturating_sub(1);
        for line in lines.iter().take(complete) {
            if let Some(delta) = parse_sse_line(line) {
                if !delta.is_empty() {
                    text.push_str(&delta);
                    on_update(delta);
                }
            }
        }
        buffer = lines.last().cloned().unwrap_or_default();
    }
    if let Some(delta) = parse_sse_line(&buffer) {
        if !delta.is_empty() {
            text.push_str(&delta);
            on_update(delta);
        }
    }

    Ok(if text.trim().is_empty() {
        "No response.".to_owned()
    } else {
        text.trim().to_owned()
    })
}

/// Uploads pasted base64 images to Claude and returns file ids for completion.
async fn upload_image_files(
    ctx: &ClaudeContext,
    conv_id: &str,
    image_data_urls: &[String],
) -> Result<Vec<String>> {
    let mut file_ids = Vec::new();
    for (index, data_url) in image_data_urls.iter().enumerate() {
        let image = parse_image_data_url(data_url, index + 1)?;
        file_ids.push(upload_image_file(ctx, conv_id, image).await?);
    }
    Ok(file_ids)
}

/// Uploads one decoded image through Claude's web file endpoint.
async fn upload_image_file(
    ctx: &ClaudeContext,
    conv_id: &str,
    image: ImageUpload,
) -> Result<String> {
    let client = reqwest::Client::new();
    let url = format!("{URL_BASE}/api/{}/upload", ctx.org_id);
    let part = Part::bytes(image.bytes)
        .file_name(image.file_name.clone())
        .mime_str(&image.mime_type)?;
    let form = Form::new()
        .part("file", part)
        .text("orgUuid", ctx.org_id.clone());
    let response = client
        .post(&url)
        .headers(claude_headers(ctx, "application/json", false)?)
        .header("Referer", format!("{URL_BASE}/chat/{conv_id}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| anyhow!("Claude image upload connection error: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Claude image upload failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }

    let value = response
        .json::<Value>()
        .await
        .map_err(|e| anyhow!("Could not parse Claude image upload response: {e}"))?;
    value
        .get("file_uuid")
        .and_then(Value::as_str)
        .or_else(|| value.get("uuid").and_then(Value::as_str))
        .or_else(|| value.as_str())
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Claude image upload did not return a file id: {value}"))
}

struct ImageUpload {
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

/// Decodes a browser data URL into an uploadable image file.
fn parse_image_data_url(data_url: &str, index: usize) -> Result<ImageUpload> {
    let (metadata, payload) = data_url
        .split_once(',')
        .ok_or_else(|| anyhow!("Invalid pasted image data."))?;
    let mime_type = metadata
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))
        .ok_or_else(|| anyhow!("Only pasted image data URLs can be sent."))?
        .to_owned();
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| anyhow!("Could not decode pasted image data: {e}"))?;
    let extension = image_extension(&mime_type);
    Ok(ImageUpload {
        file_name: format!("pasted-image-{index}.{extension}"),
        mime_type,
        bytes,
    })
}

/// Maps common image MIME types to stable file extensions.
fn image_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "img",
    }
}

/// Parses one `data:` line from the Claude SSE stream. Returns text delta.
fn parse_sse_line(line: &str) -> Option<String> {
    if !line.starts_with("data: ") {
        return None;
    }
    let payload = line.trim_start_matches("data: ").trim();
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    let event: Value = serde_json::from_str(payload).ok()?;
    let event_type = event.get("type").and_then(Value::as_str)?;
    if event_type == "content_block_delta" {
        let delta = event.get("delta")?;
        if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
            return delta.get("text").and_then(Value::as_str).map(str::to_owned);
        }
    }
    None
}

/// Generates a UUID v4 string.
fn uuid_v4() -> String {
    use rand::Rng;
    let mut bytes = [0u8; 16];
    rand::rng().fill(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}
