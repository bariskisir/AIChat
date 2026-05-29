//! Streaming SSE response handling for ChatGPT Codex chat requests.

use super::{
    AccessContext, CHATGPT_RESPONSES_URL, ChatRequest, ChatRequestMessage, chatgpt_headers,
};
use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde_json::{Value, json};

/// Streams a chat response from ChatGPT while reporting partial text.
pub async fn stream_chat_response<F>(
    access: &AccessContext,
    request: ChatRequest,
    mut on_update: F,
) -> Result<String>
where
    F: FnMut(String) + Send,
{
    let client = reqwest::Client::new();
    let response = client
        .post(CHATGPT_RESPONSES_URL)
        .headers(chatgpt_headers(access, "text/event-stream", true)?)
        .json(&json!({
            "model": request.model,
            "input": request.messages.iter().map(chat_message_payload).collect::<Vec<_>>(),
            "stream": true,
            "store": false,
            "text": {"verbosity": request.response_style},
            "reasoning": {"effort": request.thinking_variant, "summary": "auto"},
            "instructions": "."
        }))
        .send()
        .await
        .context("Could not reach ChatGPT")?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "ChatGPT request failed with status {status}. {}",
            body.chars().take(240).collect::<String>()
        ));
    }
    read_sse_response(response, &mut on_update).await
}

/// Builds one Responses API message payload from a stored chat message.
fn chat_message_payload(message: &ChatRequestMessage) -> Value {
    let text_type = if message.role == "assistant" {
        "output_text"
    } else {
        "input_text"
    };
    let mut content = Vec::new();
    if !message.text.trim().is_empty() {
        content.push(json!({"type": text_type, "text": message.text}));
    }
    if message.role == "user" {
        for image_data_url in &message.image_data_urls {
            if !image_data_url.trim().is_empty() {
                content.push(json!({"type": "input_image", "image_url": image_data_url}));
            }
        }
    }
    if content.is_empty() {
        content.push(json!({"type": text_type, "text": "."}));
    }
    json!({"type": "message", "role": message.role, "content": content})
}

/// Reads the SSE byte stream and returns the final assistant text.
async fn read_sse_response<F>(response: reqwest::Response, on_update: &mut F) -> Result<String>
where
    F: FnMut(String) + Send,
{
    let mut text = String::new();
    let mut completed_text = String::new();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Could not read ChatGPT response stream")?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        let lines: Vec<_> = buffer
            .split('\n')
            .map(|l| l.trim_end_matches('\r').to_owned())
            .collect();
        let complete_line_count = lines.len().saturating_sub(1);
        for line in lines.iter().take(complete_line_count) {
            if let Some(part) = parse_sse_line(line) {
                if !part.delta.is_empty() {
                    text.push_str(&part.delta);
                    on_update(part.delta);
                }
                if !part.completed_text.is_empty() {
                    completed_text = part.completed_text;
                }
            }
        }
        buffer = lines.last().cloned().unwrap_or_default();
    }
    if let Some(part) = parse_sse_line(&buffer) {
        if !part.delta.is_empty() {
            text.push_str(&part.delta);
            on_update(part.delta);
        }
        if !part.completed_text.is_empty() {
            completed_text = part.completed_text;
        }
    }
    let final_text = if text.trim().is_empty() {
        completed_text.trim().to_owned()
    } else {
        text.trim().to_owned()
    };
    Ok(if final_text.is_empty() {
        "No response text was returned.".to_owned()
    } else {
        final_text
    })
}

struct SsePart {
    delta: String,
    completed_text: String,
}

/// Parses one server-sent event line from the ChatGPT stream.
fn parse_sse_line(line: &str) -> Option<SsePart> {
    if !line.starts_with("data:") {
        return None;
    }
    let payload = line.trim_start_matches("data:").trim();
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    let event: Value = serde_json::from_str(payload).ok()?;
    let delta = extract_delta_text(&event).unwrap_or_default();
    let completed_text = if event.get("type").and_then(Value::as_str) == Some("response.completed")
    {
        extract_completed_text(event.get("response").unwrap_or(&event))
    } else {
        String::new()
    };
    Some(SsePart {
        delta,
        completed_text,
    })
}

/// Extracts incremental output text from a stream event.
fn extract_delta_text(event: &Value) -> Option<String> {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type.contains("reasoning") {
        return None;
    }
    if event_type.contains("input")
        || event_type.contains("usage")
        || event_type.contains("completed")
        || event_type.contains("complete")
        || event_type.contains("done")
    {
        return None;
    }
    event_delta_text(event).or_else(|| find_stream_text(event, 0))
}

/// Extracts a delta string from common ChatGPT stream payload shapes.
fn event_delta_text(event: &Value) -> Option<String> {
    event
        .get("delta")
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("delta")
                .and_then(|value| value.get("text"))
                .and_then(Value::as_str)
        })
        .or_else(|| event.get("text").and_then(Value::as_str))
        .or_else(|| event.get("content").and_then(Value::as_str))
        .map(str::to_owned)
}

/// Recursively finds output text in less common SSE payload shapes.
fn find_stream_text(value: &Value, depth: usize) -> Option<String> {
    if depth > 5 {
        return None;
    }
    match value {
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_stream_text(item, depth + 1)),
        Value::Object(map) => {
            if map
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|value| value.contains("reasoning") || value.contains("input"))
            {
                return None;
            }
            for key in ["delta", "text", "content", "value"] {
                if let Some(text) = map.get(key).and_then(Value::as_str)
                    && !text.trim().is_empty()
                {
                    return Some(text.to_owned());
                }
            }
            for key in [
                "delta", "text", "content", "value", "item", "part", "message", "output",
            ] {
                if let Some(text) = map
                    .get(key)
                    .and_then(|nested| find_stream_text(nested, depth + 1))
                {
                    return Some(text);
                }
            }
            for (key, nested) in map {
                if matches!(key.as_str(), "type" | "role" | "id" | "status" | "model") {
                    continue;
                }
                if let Some(text) = find_stream_text(nested, depth + 1) {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

/// Extracts final output text from a completed response payload.
fn extract_completed_text(root: &Value) -> String {
    root.get("output")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
                .filter_map(|message| message.get("content").and_then(Value::as_array))
                .flat_map(|content| content.iter())
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
}
