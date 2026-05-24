//! ChatGPT OAuth login, token exchange, and token refresh.

use super::{
    CHATGPT_AUTH_URL, CHATGPT_CLIENT_ID, CHATGPT_ORIGINATOR, CHATGPT_SCOPE, CHATGPT_TOKEN_URL,
    OAUTH_REDIRECT_URL, read_jwt_claim,
};
use crate::domain::{AuthStorage, PendingOAuth};
use anyhow::{Context, Result, anyhow};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use rand::RngCore;
use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Creates OAuth PKCE state and the ChatGPT authorization URL.
pub fn create_login_request() -> Result<(PendingOAuth, String)> {
    let verifier = random_base64_url(32);
    let state = random_base64_url(16);
    let challenge = code_challenge(&verifier);
    let pending = PendingOAuth {
        state: state.clone(),
        verifier,
        started_at: Utc::now().timestamp_millis(),
    };
    let params = [
        ("response_type", "code"),
        ("client_id", CHATGPT_CLIENT_ID),
        ("redirect_uri", OAUTH_REDIRECT_URL),
        ("scope", CHATGPT_SCOPE),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("state", &state),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("originator", CHATGPT_ORIGINATOR),
    ];
    let query = params
        .into_iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                urlencoding::encode(key),
                urlencoding::encode(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    Ok((pending, format!("{CHATGPT_AUTH_URL}?{query}")))
}

/// Waits for the local OAuth callback and extracts its code.
pub async fn wait_for_oauth_callback(expected_state: String) -> Result<String> {
    let listener = TcpListener::bind(("127.0.0.1", 1455))
        .await
        .context("Could not start ChatGPT callback listener on localhost:1455")?;
    let (mut stream, _) = listener
        .accept()
        .await
        .context("Could not accept ChatGPT callback")?;
    let mut buffer = vec![0_u8; 8192];
    let bytes = stream.read(&mut buffer).await?;
    let request = String::from_utf8_lossy(&buffer[..bytes]);
    let first_line = request.lines().next().unwrap_or_default();
    let path = first_line.split_whitespace().nth(1).unwrap_or_default();
    let parsed = parse_callback_path(path)?;
    let success = parsed.state == expected_state && !parsed.code.is_empty();
    let body = if success {
        "ChatGPT Helper sign-in complete. You can close this tab."
    } else {
        "ChatGPT Helper sign-in failed. Return to the app and try again."
    };
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let _ = stream
        .write_all(
            format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}")
                .as_bytes(),
        )
        .await;
    if parsed.state != expected_state {
        return Err(anyhow!(
            "OAuth state mismatch. Please try signing in again."
        ));
    }
    if parsed.code.is_empty() {
        return Err(anyhow!(
            "The ChatGPT callback did not include an authorization code."
        ));
    }
    Ok(parsed.code)
}

/// Exchanges an OAuth authorization code for stored tokens.
pub async fn exchange_authorization_code(code: &str, verifier: &str) -> Result<AuthStorage> {
    let client = reqwest::Client::new();
    let response = client
        .post(CHATGPT_TOKEN_URL)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", CHATGPT_CLIENT_ID),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", OAUTH_REDIRECT_URL),
        ])
        .send()
        .await
        .context("Could not exchange ChatGPT authorization code")?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "Token exchange failed with status {}",
            response.status()
        ));
    }
    parse_token_response(response.json::<Value>().await?)
}

/// Refreshes the ChatGPT access token using the refresh token.
pub async fn refresh_access_token(auth: &AuthStorage) -> Result<AuthStorage> {
    if auth.refresh_token.is_empty() {
        return Err(anyhow!(
            "Your ChatGPT session expired. Please sign in again."
        ));
    }
    let client = reqwest::Client::new();
    let response = client
        .post(CHATGPT_TOKEN_URL)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", auth.refresh_token.as_str()),
            ("client_id", CHATGPT_CLIENT_ID),
        ])
        .send()
        .await
        .context("Could not refresh ChatGPT token")?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "Token refresh failed with status {}",
            response.status()
        ));
    }
    parse_token_response(response.json::<Value>().await?)
}

struct CallbackParams {
    code: String,
    state: String,
}

/// Parses OAuth callback query parameters from the request path.
fn parse_callback_path(path: &str) -> Result<CallbackParams> {
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
    let mut code = String::new();
    let mut state = String::new();
    for part in query.split('&') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        let decoded = urlencoding::decode(value)?.into_owned();
        match key {
            "code" => code = decoded,
            "state" => state = decoded,
            _ => {}
        }
    }
    Ok(CallbackParams { code, state })
}

/// Validates and maps the ChatGPT token response into auth storage.
fn parse_token_response(payload: Value) -> Result<AuthStorage> {
    let access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let expires_in = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .or_else(|| {
            payload
                .get("expires_in")
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<i64>().ok())
        })
        .unwrap_or_default();
    if access_token.is_empty() || refresh_token.is_empty() || expires_in <= 0 {
        return Err(anyhow!("ChatGPT returned an invalid token response."));
    }
    Ok(AuthStorage {
        account_email: read_jwt_claim(&access_token, &["https://api.openai.com/profile", "email"])
            .or_else(|| read_jwt_claim(&access_token, &["email"]))
            .unwrap_or_default(),
        chatgpt_account_id: read_jwt_claim(
            &access_token,
            &["https://api.openai.com/auth", "chatgpt_account_id"],
        )
        .unwrap_or_default(),
        access_token,
        refresh_token,
        expires_at: Utc::now().timestamp_millis() + expires_in * 1000,
        pending_oauth: None,
        error: String::new(),
    })
}

/// Generates random URL-safe base64 text for OAuth values.
fn random_base64_url(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Builds the OAuth PKCE S256 code challenge.
fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
