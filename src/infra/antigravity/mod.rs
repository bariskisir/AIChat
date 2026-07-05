//! Antigravity (Gemini Code Assist) client: calls the Google Cloud Code API.
//!
//! The provider uses a Bearer access token from Windows Credential Manager
//! (or provider API key fallback) to call:
//!   POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
//!   POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
//!   POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
//!   POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary

mod auth;
mod catalog;
mod streaming;
mod usage;

pub use auth::{AntigravityAuth, credentials_available, read_credentials, write_credentials};
pub use catalog::fetch_models;
pub use streaming::{AntigravityChatRequest, AntigravityMessage, stream_chat_response};
pub use usage::{fetch_cli_version, fetch_project, fetch_usage};

use anyhow::{Context, Result};

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde_json::Value;

const API_BASE: &str = "https://daily-cloudcode-pa.googleapis.com";
pub(crate) const DEFAULT_CLI_VERSION: &str = "1.0.14";
const TOKEN_REFRESH_URL: &str = "https://oauth2.googleapis.com/token";
const OAUTH_CLIENT_ID: &str = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET: &str = "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";

#[derive(Clone, Debug)]
pub struct AntigravityContext {
    pub access_token: String,
    pub project_id: String,
    pub user_agent: String,
}

impl AntigravityContext {
    /// Builds a request context from stored token, cached project ID, and CLI version.
    pub fn new(access_token: &str, project_id: &str, cli_version: &str) -> Self {
        let version = if cli_version.is_empty() {
            DEFAULT_CLI_VERSION
        } else {
            cli_version
        };
        let user_agent = format!(
            "antigravity/cli/{version} (aidev_client; os_type=windows; arch=amd64; auth_method=consumer)"
        );
        Self {
            access_token: access_token.to_owned(),
            project_id: project_id.to_owned(),
            user_agent,
        }
    }
}

/// Refreshes the access token using the stored refresh token.
pub async fn refresh_access_token(refresh_token: &str) -> Result<AntigravityAuth> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_REFRESH_URL)
        .form(&[
            ("client_id", OAUTH_CLIENT_ID),
            ("client_secret", OAUTH_CLIENT_SECRET),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .header(ACCEPT, "application/json")
        .send()
        .await
        .context("Failed to refresh antigravity access token")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_owned());
        return Err(anyhow::anyhow!(
            "Antigravity token refresh failed with HTTP {status}: {}",
            truncate_body(&text)
        ));
    }

    let json: Value = response
        .json()
        .await
        .context("Failed to parse token refresh response")?;

    let new_access_token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .context("Token refresh response missing access_token")?
        .to_owned();

    let expires_in = json.get("expires_in").and_then(|v| v.as_f64());
    let expiry = expires_in.map(|seconds| {
        chrono::Utc::now() + chrono::TimeDelta::seconds(seconds as i64)
    });

    let id_token = json
        .get("id_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();
    let email = if !id_token.is_empty() {
        crate::infra::chatgpt::read_jwt_claim(&id_token, &["email"])
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(AntigravityAuth {
        access_token: new_access_token,
        refresh_token: json
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or(refresh_token)
            .to_owned(),
        expiry,
        id_token,
        email,
    })
}

/// Reports whether the auth token is expired or unset.
pub fn auth_expired(auth: &AntigravityAuth) -> bool {
    auth.expiry.map_or(true, |expiry| chrono::Utc::now() >= expiry)
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

/// Builds HTTP headers authorized with the antigravity Bearer token.
fn antigravity_headers(access_token: &str, user_agent: &str) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))?,
    );
    headers.insert(
        reqwest::header::USER_AGENT,
        HeaderValue::from_str(user_agent)?,
    );
    Ok(headers)
}

/// Builds HTTP headers for SSE streaming requests.
fn antigravity_sse_headers(access_token: &str, user_agent: &str) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))?,
    );
    headers.insert(
        reqwest::header::USER_AGENT,
        HeaderValue::from_str(user_agent)?,
    );
    Ok(headers)
}
