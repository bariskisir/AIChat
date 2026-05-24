//! ChatGPT OAuth, model catalog, usage, and streaming response helpers.

mod catalog;
mod oauth;
mod streaming;
mod usage;

pub use catalog::fetch_model_catalog;
pub use oauth::{
    create_login_request, exchange_authorization_code, refresh_access_token,
    wait_for_oauth_callback,
};
pub use streaming::stream_chat_response;
pub use usage::fetch_usage_limit_label;

use crate::domain::{AuthStorage, DEFAULT_CODEX_CLIENT_VERSION};
use anyhow::Result;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde_json::Value;

const CHATGPT_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_ORIGINATOR: &str = "codex_cli_rs";
const CHATGPT_SCOPE: &str = "openid profile email offline_access";
const CHATGPT_AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const CHATGPT_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CHATGPT_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const CHATGPT_MODELS_URL: &str = "https://chatgpt.com/backend-api/codex/models";
const CHATGPT_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_LATEST_URL: &str = "https://registry.npmjs.org/@openai/codex/latest";
const OAUTH_REDIRECT_URL: &str = "http://localhost:1455/auth/callback";

#[derive(Clone, Debug)]
pub struct AccessContext {
    pub access_token: String,
    pub chatgpt_account_id: String,
}

impl AccessContext {
    /// Builds request access context from stored authentication data.
    pub fn from_auth(auth: &AuthStorage) -> Self {
        Self {
            access_token: auth.access_token.clone(),
            chatgpt_account_id: if auth.chatgpt_account_id.is_empty() {
                read_jwt_claim(
                    &auth.access_token,
                    &["https://api.openai.com/auth", "chatgpt_account_id"],
                )
                .unwrap_or_default()
            } else {
                auth.chatgpt_account_id.clone()
            },
        }
    }
}

#[derive(Clone, Debug)]
pub struct ChatRequest {
    pub messages: Vec<ChatRequestMessage>,
    pub model: String,
    pub thinking_variant: String,
    pub response_style: String,
}

#[derive(Clone, Debug)]
pub struct ChatRequestMessage {
    pub role: String,
    pub text: String,
    pub image_data_urls: Vec<String>,
}

/// Builds ChatGPT API headers for account-scoped requests.
fn chatgpt_headers(access: &AccessContext, accept: &str, json_content: bool) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_str(accept)?);
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", access.access_token))?,
    );
    headers.insert("originator", HeaderValue::from_static(CHATGPT_ORIGINATOR));
    if json_content {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            "OpenAI-Beta",
            HeaderValue::from_static("responses=experimental"),
        );
    }
    if !access.chatgpt_account_id.is_empty() {
        headers.insert(
            "chatgpt-account-id",
            HeaderValue::from_str(&access.chatgpt_account_id)?,
        );
    }
    Ok(headers)
}

/// Reads a string claim from a JWT payload path without verifying it.
fn read_jwt_claim(token: &str, path: &[&str]) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let mut value: Value = serde_json::from_slice(&bytes).ok()?;
    for key in path {
        value = value.get(*key)?.clone();
    }
    value.as_str().map(str::to_owned)
}

/// Fetches the latest Codex client version with a local fallback.
async fn fetch_codex_client_version() -> String {
    let client = reqwest::Client::new();
    let Ok(response) = client
        .get(CODEX_LATEST_URL)
        .header(ACCEPT, "application/json")
        .send()
        .await
    else {
        return DEFAULT_CODEX_CLIENT_VERSION.to_owned();
    };
    if !response.status().is_success() {
        return DEFAULT_CODEX_CLIENT_VERSION.to_owned();
    }
    let Ok(payload) = response.json::<Value>().await else {
        return DEFAULT_CODEX_CLIENT_VERSION.to_owned();
    };
    payload
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_CODEX_CLIENT_VERSION)
        .to_owned()
}
