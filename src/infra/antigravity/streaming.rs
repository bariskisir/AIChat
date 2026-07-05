//! Antigravity SSE chat streaming against the Google Cloud Code API.

use super::{antigravity_sse_headers, AntigravityContext, API_BASE};
use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AntigravityMessage {
    pub role: String,
    pub text: String,
    pub image_data_urls: Vec<String>,
}

#[derive(Serialize)]
pub struct AntigravityChatRequest {
    pub model: String,
    pub messages: Vec<AntigravityMessage>,
    pub request_type: String,
}

const MAX_OUTPUT_TOKENS: u32 = 16384;

/// Streams a chat response from the antigravity SSE endpoint.
pub async fn stream_chat_response<F>(
    ctx: &AntigravityContext,
    request: AntigravityChatRequest,
    on_update: F,
) -> Result<String>
where
    F: FnMut(String) + Send,
{
    let url = format!("{API_BASE}/v1internal:streamGenerateContent?alt=sse");
    let body = build_chat_body(ctx, &request)?;
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .headers(antigravity_sse_headers(&ctx.access_token, &ctx.user_agent)?)
        .json(&body)
        .send()
        .await
        .context("Failed to start antigravity chat stream")?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_owned());
        return Err(anyhow!(
            "Antigravity chat returned HTTP {status}: {}",
            truncate_body(&text)
        ));
    }
    let mut stream = response.bytes_stream();
    let mut final_text = String::new();
    let mut on_update = on_update;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Error reading antigravity stream chunk")?;
        let text = std::str::from_utf8(&chunk).unwrap_or("");
        for line in text.lines() {
            if let Some(delta) = parse_sse_line(line) {
                final_text.push_str(&delta);
                on_update(delta);
            }
        }
    }
    let trimmed = final_text.trim().to_owned();
    if trimmed.is_empty() {
        Ok("No response text was returned.".to_owned())
    } else {
        Ok(trimmed)
    }
}

/// Builds the JSON body for the antigravity chat request.
fn build_chat_body(
    ctx: &AntigravityContext,
    request: &AntigravityChatRequest,
) -> Result<serde_json::Value> {
    use serde_json::json;
    let contents: Vec<serde_json::Value> = request
        .messages
        .iter()
        .filter(|m| !m.text.is_empty() || !m.image_data_urls.is_empty())
        .map(|m| {
            let role = if m.role == "user" { "user" } else { "model" };
            let mut parts = Vec::new();
            if !m.text.is_empty() {
                parts.push(json!({ "text": m.text }));
            }
            for img in &m.image_data_urls {
                parts.push(json!({
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": img.trim_start_matches("data:image/png;base64,")
                    }
                }));
            }
            json!({ "role": role, "parts": parts })
        })
        .collect();
    let request_id = format!(
        "chat-{}",
        uuid::Uuid::new_v4()
    );
    let session_id = format!(
        "-{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    );
    Ok(json!({
        "project": &ctx.project_id,
        "requestId": request_id,
        "request": {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": MAX_OUTPUT_TOKENS,
                "thinkingConfig": {
                    "includeThoughts": false,
                    "thinkingBudget": 0
                }
            },
            "sessionId": session_id
        },
        "model": request.model,
        "userAgent": "antigravity",
        "requestType": request.request_type
    }))
}

/// Parses one SSE line from the antigravity stream response.
fn parse_sse_line(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() || line == "[DONE]" {
        return None;
    }
    let data = line.strip_prefix("data: ").or_else(|| line.strip_prefix("data:"))?;
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    parsed
        .pointer("/response/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .map(String::from)
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
