//! OpenAI-compatible REST API client for model discovery and chat streaming.

use crate::domain::{AvailableModel, ProviderConfig};
use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug)]
pub struct OpenAiContext {
    pub provider_id: String,
    pub provider_name: String,
    pub api_url: String,
    pub api_key: String,
    pub custom_headers: Vec<(String, String)>,
}

impl OpenAiContext {
    /// Builds a request context from a saved provider.
    pub fn from_provider(provider: &ProviderConfig) -> Self {
        Self {
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            api_url: provider.api_url.trim().trim_end_matches('/').to_owned(),
            api_key: provider.api_key.clone(),
            custom_headers: provider
                .custom_headers
                .iter()
                .map(|header| (header.name.clone(), header.value.clone()))
                .collect(),
        }
    }

    /// Reports whether the context targets the built-in OpenCode provider.
    fn is_opencode(&self) -> bool {
        self.provider_id == crate::domain::OPENCODE_PROVIDER_ID
    }

    /// Reports whether OpenCode is using the public session.
    fn is_opencode_public(&self) -> bool {
        self.is_opencode() && self.api_key.trim().eq_ignore_ascii_case("public")
    }
}

#[derive(Clone, Debug)]
pub struct OpenAiChatRequest {
    pub model: String,
    pub messages: Vec<OpenAiMessage>,
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Debug)]
pub struct OpenAiMessage {
    pub role: String,
    pub text: String,
    pub image_data_urls: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelItem>,
}

#[derive(Debug, Deserialize)]
struct ModelItem {
    id: String,
    #[serde(default)]
    owned_by: String,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
}

#[derive(Default, Debug, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ChatMessageBody {
    role: String,
    content: Value,
}

/// Fetches models from the provider's `/models` endpoint.
pub async fn fetch_models(ctx: &OpenAiContext) -> Result<Vec<AvailableModel>> {
    let url = endpoint(ctx, "models");
    let response = reqwest::Client::new()
        .get(&url)
        .headers(headers(ctx)?)
        .send()
        .await
        .with_context(|| format!("Could not connect to {}", ctx.provider_name))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!(
            "{} models request failed with status {status}. {}",
            ctx.provider_name,
            truncate_body(&text)
        ));
    }
    let parsed: ModelsResponse = serde_json::from_str(&text)
        .with_context(|| format!("Could not parse {} models response", ctx.provider_name))?;
    let mut models = parsed
        .data
        .into_iter()
        .filter(|item| !ctx.is_opencode_public() || item.id.to_lowercase().contains("free"))
        .map(|item| AvailableModel {
            provider_id: ctx.provider_id.clone(),
            provider_name: ctx.provider_name.clone(),
            display_name: item.id.clone(),
            description: item.owned_by,
            model: item.id,
            hidden: false,
            is_default: false,
            input_modalities: vec!["text".to_owned()],
            default_thinking_variant: crate::domain::DEFAULT_THINKING_VARIANT.to_owned(),
            thinking_variants: crate::domain::fallback_thinking_variants(),
            support_verbosity: false,
            default_verbosity: crate::domain::DEFAULT_VERBOSITY.to_owned(),
            claude_thinking_type: String::new(),
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.model.cmp(&right.model));
    Ok(models)
}

/// Sends a streaming chat completion request and returns the final text.
pub async fn stream_chat_response(
    ctx: &OpenAiContext,
    request: OpenAiChatRequest,
    mut on_delta: impl FnMut(String) + Send + 'static,
) -> Result<String> {
    let url = endpoint(ctx, "chat/completions");
    let request_has_images = request
        .messages
        .iter()
        .any(|message| !message.image_data_urls.is_empty());
    let body = chat_body(request);
    let response = reqwest::Client::new()
        .post(&url)
        .headers(headers(ctx)?)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("Could not connect to {}", ctx.provider_name))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        if request_has_images && image_payload_rejected(&text) {
            return Err(anyhow!(
                "{} does not support image attachments for this model. Remove the image or choose a vision-capable model.",
                ctx.provider_name
            ));
        }
        return Err(anyhow!(
            "{} chat request failed with status {status}. {}",
            ctx.provider_name,
            truncate_body(&text)
        ));
    }

    let mut final_text = String::new();
    let mut pending = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Could not read chat stream")?;
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim().to_owned();
            pending = pending[index + 1..].to_owned();
            if let Some(delta) = parse_sse_line(&line)? {
                final_text.push_str(&delta);
                on_delta(delta);
            }
        }
    }
    Ok(final_text)
}

/// Detects provider errors caused by OpenAI image content parts.
fn image_payload_rejected(body: &str) -> bool {
    let body = body.to_lowercase();
    body.contains("image_url")
        && (body.contains("unknown variant")
            || body.contains("expected `text`")
            || body.contains("expected text")
            || body.contains("unsupported")
            || body.contains("invalid_request_error"))
}

/// Converts a chat request into an OpenAI-compatible JSON body.
fn chat_body(request: OpenAiChatRequest) -> Value {
    let mut body = json!({
        "model": request.model,
        "stream": true,
        "messages": request.messages.into_iter().map(message_body).collect::<Vec<_>>(),
    });
    if let Some(reasoning_effort) = request.reasoning_effort
        && reasoning_effort != "none"
    {
        body["reasoning_effort"] = json!(reasoning_effort);
    }
    body
}

/// Converts one internal message into a chat completion message.
fn message_body(message: OpenAiMessage) -> ChatMessageBody {
    let content = if message.image_data_urls.is_empty() {
        json!(message.text)
    } else {
        let mut parts = Vec::new();
        if !message.text.trim().is_empty() {
            parts.push(json!({ "type": "text", "text": message.text }));
        }
        for image_data_url in message.image_data_urls {
            parts.push(json!({ "type": "image_url", "image_url": { "url": image_data_url } }));
        }
        Value::Array(parts)
    };
    ChatMessageBody {
        role: message.role,
        content,
    }
}

/// Parses one Server-Sent Events line from a streaming response.
fn parse_sse_line(line: &str) -> Result<Option<String>> {
    let Some(data) = line.strip_prefix("data:") else {
        return Ok(None);
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return Ok(None);
    }
    let chunk: StreamChunk = serde_json::from_str(data).context("Could not parse chat stream")?;
    let Some(content) = chunk
        .choices
        .first()
        .and_then(|choice| choice.delta.content.as_ref())
    else {
        return Ok(None);
    };
    if let Some(text) = content.as_str() {
        return Ok(Some(text.to_owned()));
    }
    let text = content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<String>();
    Ok((!text.is_empty()).then_some(text))
}

/// Dispatches to the appropriate header builder for the given provider.
fn headers(ctx: &OpenAiContext) -> Result<HeaderMap> {
    if ctx.is_opencode() {
        opencode_headers(ctx)
    } else {
        standard_headers(ctx)
    }
}

/// Builds headers for an OpenCode Zen provider request.
fn opencode_headers(ctx: &OpenAiContext) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    if !ctx.api_key.trim().is_empty() {
        headers.insert(
            HeaderName::from_static("x-opencode-session"),
            HeaderValue::from_str(ctx.api_key.trim())
                .context("OpenCode token contains invalid characters")?,
        );
    }
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    for (name, value) in &ctx.custom_headers {
        if name.eq_ignore_ascii_case("x-opencode-session") {
            continue;
        }
        let header_name = HeaderName::from_bytes(name.trim().as_bytes())
            .with_context(|| format!("Invalid custom header name: {name}"))?;
        let header_value = HeaderValue::from_str(value)
            .with_context(|| format!("Invalid custom header value for {name}"))?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

/// Builds headers for a standard OpenAI-compatible provider request.
fn standard_headers(ctx: &OpenAiContext) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    if !ctx.api_key.trim().is_empty() {
        let token = format!("Bearer {}", ctx.api_key.trim());
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&token)
                .context("Provider API key contains invalid characters")?,
        );
    }
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    for (name, value) in &ctx.custom_headers {
        let header_name = HeaderName::from_bytes(name.trim().as_bytes())
            .with_context(|| format!("Invalid custom header name: {name}"))?;
        let header_value = HeaderValue::from_str(value)
            .with_context(|| format!("Invalid custom header value for {name}"))?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

/// Joins a provider base URL with an endpoint path.
fn endpoint(ctx: &OpenAiContext, path: &str) -> String {
    format!("{}/{}", ctx.api_url.trim_end_matches('/'), path)
}

/// Keeps provider error bodies readable in the UI.
fn truncate_body(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() > 800 {
        format!("{}...", trimmed.chars().take(800).collect::<String>())
    } else {
        trimmed.to_owned()
    }
}
