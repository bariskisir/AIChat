//! Codex credential reading from the local Codex CLI auth store.
//!
//! Reads `~/.codex/auth.json` written by the Codex CLI. No in-app login needed;
//! the token is read fresh from disk on each call (the CLI keeps it refreshed).

use crate::domain::messages::*;
use crate::domain::CodexCredentials;
use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::path::PathBuf;

const CODEX_DIR: &str = ".codex";

/// Resolves the `~/.codex/auth.json` path used by the Codex CLI.
fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(CODEX_DIR).join("auth.json"))
}

/// Reports whether a Codex credentials file exists on disk.
pub fn credentials_available() -> bool {
    credentials_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

/// Reads and parses the local Codex CLI OAuth credentials.
pub fn read_credentials() -> Result<CodexCredentials> {
    let path = credentials_path().ok_or_else(|| anyhow!(AUTH_CODEX_CREDENTIALS_PROMPT))?;
    if !path.exists() {
        return Err(anyhow!(AUTH_CODEX_CREDENTIALS_PROMPT));
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("Could not read {}", path.display()))?;
    let text = text.trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(text)
        .context("Could not parse Codex credentials file")?;
    let access_token = value
        .pointer("/tokens/access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| anyhow!(AUTH_CODEX_CREDENTIALS_PROMPT))?
        .to_owned();
    let account_id = value
        .pointer("/tokens/account_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let plan = value
        .pointer("/tokens/id_token")
        .and_then(Value::as_str)
        .and_then(|id_token| {
            crate::infra::chatgpt::read_jwt_claim(
                id_token,
                &["https://api.openai.com/auth", "chatgpt_plan_type"],
            )
        })
        .unwrap_or_default();
    let email = value
        .pointer("/tokens/id_token")
        .and_then(Value::as_str)
        .and_then(|id_token| {
            crate::infra::chatgpt::read_jwt_claim(
                id_token,
                &["https://api.openai.com/profile", "email"],
            )
            .or_else(|| {
                crate::infra::chatgpt::read_jwt_claim(id_token, &["email"])
            })
        })
        .unwrap_or_default();
    Ok(CodexCredentials {
        access_token,
        account_id,
        plan,
        email,
    })
}
