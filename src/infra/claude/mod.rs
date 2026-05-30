//! Claude.ai REST API client: cookie-based auth and SSE streaming.
//!
//! Endpoints (reverse-engineered from claude.ai web app):
//!   POST /api/organizations/{org_id}/chat_conversations          - create chat
//!   POST /api/organizations/{org_id}/chat_conversations/{id}/completion  - send message (SSE)
//!   DELETE /api/organizations/{org_id}/chat_conversations/{id}   - delete chat
//! Auth: Cookie header with sessionKey

use crate::domain::ClaudeCredential;
use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderValue};
use reqwest::multipart::{Form, Part};
use serde_json::Value;

mod catalog;
pub(crate) use catalog::{parse_account_info, parse_model_response_for_plan};

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
    pub effort: Option<String>,
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
    let human_uuid = uuid::Uuid::new_v4().to_string();
    let assistant_uuid = uuid::Uuid::new_v4().to_string();
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
        "thinking_mode": if request.extended_thinking { "auto" } else { "off" },
    });

    if request.extended_thinking {
        payload["thinking_mode"] = serde_json::json!("auto");
        if let Some(effort) = request.effort.as_deref() {
            payload["effort"] = serde_json::json!(effort);
        }
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

