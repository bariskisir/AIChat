//! Claude Code client: reads local CLI OAuth credentials and calls the Anthropic API.
//!
//! Credentials are read from `~/.claude/.credentials.json` (written by the Claude
//! Code CLI). The stored OAuth access token authorizes direct calls to:
//!   GET  https://api.anthropic.com/v1/models          - model catalog
//!   GET  https://api.anthropic.com/api/oauth/usage     - usage limits
//!   POST https://api.anthropic.com/v1/messages?beta=true - chat (SSE)

mod catalog;
mod streaming;
mod usage;

pub use catalog::fetch_models;
pub use streaming::{ClaudeCodeChatRequest, ClaudeCodeMessage, stream_chat_response};
pub use usage::fetch_usage;

use anyhow::{Context, Result, anyhow};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde_json::Value;
use std::path::PathBuf;

const API_BASE: &str = "https://api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const CLAUDE_CODE_USER_AGENT: &str = "claude-cli/2.1.168 (external, cli)";

/// Full anthropic-beta feature list sent with chat completions.
const ANTHROPIC_BETA_CHAT: &str = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11,cache-diagnosis-2026-04-07";

/// Minimal anthropic-beta value used for metadata requests (models, usage).
const ANTHROPIC_BETA_META: &str = "oauth-2025-04-20";

/// The required Claude Code system identity prompt for OAuth-scoped requests.
pub const CLAUDE_CODE_SYSTEM_PROMPT: &str =
    "You are Claude Code, Anthropic's official CLI for Claude.";

#[derive(Clone, Debug)]
pub struct ClaudeCodeContext {
    pub access_token: String,
}

/// OAuth credentials read from the local Claude Code CLI store.
#[derive(Clone, Debug, Default)]
pub struct ClaudeCodeCredentials {
    pub access_token: String,
    pub plan: String,
}

impl ClaudeCodeContext {
    /// Builds a request context from the local Claude Code credentials.
    pub fn from_credentials(credentials: &ClaudeCodeCredentials) -> Self {
        Self {
            access_token: credentials.access_token.clone(),
        }
    }
}

/// Resolves the `~/.claude/.credentials.json` path used by the Claude Code CLI.
fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join(".credentials.json"))
}

/// Reports whether a Claude Code credentials file exists on disk.
pub fn credentials_available() -> bool {
    credentials_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

/// Reads and parses the local Claude Code OAuth credentials.
pub fn read_credentials() -> Result<ClaudeCodeCredentials> {
    let path = credentials_path().ok_or_else(|| anyhow!(crate::domain::messages::AUTH_CLAUDE_CODE_REQUIRED))?;
    if !path.exists() {
        return Err(anyhow!(crate::domain::messages::AUTH_CLAUDE_CODE_REQUIRED));
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("Could not read {}", path.display()))?;
    let text = text.trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(text)
        .context("Could not parse Claude Code credentials file")?;
    let access_token = value
        .pointer("/claudeAiOauth/accessToken")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| anyhow!(crate::domain::messages::AUTH_CLAUDE_CODE_REQUIRED))?
        .to_owned();
    let plan = value
        .pointer("/claudeAiOauth/subscriptionType")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Ok(ClaudeCodeCredentials {
        access_token,
        plan,
    })
}

/// Builds Anthropic API headers authorized with the Claude Code OAuth token.
fn anthropic_headers(
    access_token: &str,
    accept: &str,
    beta: &str,
    json_content: bool,
) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_str(accept)?);
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static(ANTHROPIC_VERSION));
    headers.insert("anthropic-beta", HeaderValue::from_str(beta)?);
    headers.insert(
        "anthropic-dangerous-direct-browser-access",
        HeaderValue::from_static("true"),
    );
    headers.insert("x-app", HeaderValue::from_static("cli"));
    headers.insert(
        reqwest::header::USER_AGENT,
        HeaderValue::from_static(CLAUDE_CODE_USER_AGENT),
    );
    if json_content {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    Ok(headers)
}
