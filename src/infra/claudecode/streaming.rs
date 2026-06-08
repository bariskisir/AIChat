//! Claude Code chat streaming via the Anthropic `/v1/messages` SSE API.

use super::{
    ANTHROPIC_BETA_CHAT, API_BASE, CLAUDE_CODE_SYSTEM_PROMPT, ClaudeCodeContext, anthropic_headers,
};
use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde_json::{Value, json};

/// Default maximum output tokens requested per chat completion.
const MAX_OUTPUT_TOKENS: u32 = 32000;

#[derive(Clone, Debug)]
pub struct ClaudeCodeMessage {
    pub role: String,
    pub text: String,
    pub image_data_urls: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ClaudeCodeChatRequest {
    pub model: String,
    pub messages: Vec<ClaudeCodeMessage>,
    pub effort: Option<String>,
}

/// Streams a chat completion from the Anthropic API while reporting text deltas.
pub async fn stream_chat_response<F>(
    ctx: &ClaudeCodeContext,
    request: ClaudeCodeChatRequest,
    mut on_update: F,
) -> Result<String>
where
    F: FnMut(String) + Send,
{
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{API_BASE}/v1/messages?beta=true"))
        .headers(anthropic_headers(
            &ctx.access_token,
            "text/event-stream",
            ANTHROPIC_BETA_CHAT,
            true,
        )?)
        .json(&chat_body(&request))
        .send()
        .await
        .context("Could not reach the Anthropic messages API")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Anthropic request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }

    let mut text = String::new();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Could not read Anthropic response stream")?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        let lines: Vec<_> = buffer
            .split('\n')
            .map(|line| line.trim_end_matches('\r').to_owned())
            .collect();
        let complete = lines.len().saturating_sub(1);
        for line in lines.iter().take(complete) {
            if let Some(delta) = parse_sse_line(line)
                && !delta.is_empty()
            {
                text.push_str(&delta);
                on_update(delta);
            }
        }
        buffer = lines.last().cloned().unwrap_or_default();
    }
    if let Some(delta) = parse_sse_line(&buffer)
        && !delta.is_empty()
    {
        text.push_str(&delta);
        on_update(delta);
    }

    Ok(if text.trim().is_empty() {
        "No response text was returned.".to_owned()
    } else {
        text.trim().to_owned()
    })
}

/// Builds the Anthropic `/v1/messages` request body.
fn chat_body(request: &ClaudeCodeChatRequest) -> Value {
    let mut body = json!({
        "model": request.model,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "stream": true,
        "system": [{"type": "text", "text": CLAUDE_CODE_SYSTEM_PROMPT}],
        "messages": request.messages.iter().map(message_body).collect::<Vec<_>>(),
    });
    if let Some(effort) = request.effort.as_deref() {
        body["thinking"] = json!({"type": "adaptive"});
        body["output_config"] = json!({"effort": effort});
    }
    body
}

/// Converts one chat message into an Anthropic content-block message.
fn message_body(message: &ClaudeCodeMessage) -> Value {
    let mut content = Vec::new();
    if !message.text.trim().is_empty() {
        content.push(json!({"type": "text", "text": message.text}));
    }
    if message.role == "user" {
        for data_url in &message.image_data_urls {
            if let Some(image) = image_block(data_url) {
                content.push(image);
            }
        }
    }
    if content.is_empty() {
        content.push(json!({"type": "text", "text": "."}));
    }
    json!({"role": message.role, "content": content})
}

/// Converts a base64 data URL into an Anthropic image content block.
fn image_block(data_url: &str) -> Option<Value> {
    let (metadata, payload) = data_url.split_once(',')?;
    let media_type = metadata
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))?;
    Some(json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": payload,
        }
    }))
}

/// Parses one SSE `data:` line and returns a text delta when present.
fn parse_sse_line(line: &str) -> Option<String> {
    let payload = line.strip_prefix("data:")?.trim();
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    let event: Value = serde_json::from_str(payload).ok()?;
    if event.get("type").and_then(Value::as_str)? != "content_block_delta" {
        return None;
    }
    let delta = event.get("delta")?;
    if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
        return delta.get("text").and_then(Value::as_str).map(str::to_owned);
    }
    None
}
