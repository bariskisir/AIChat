//! JSON file persistence for settings, providers, and chat sessions.

use crate::domain::{
    AppSettings, AuthStorage, CatalogStorage, ChatSession, ClaudeCredential, ProviderStorage,
    SESSION_LIMIT,
};
use crate::infra::paths::AppPaths;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Storage {
    settings: PathBuf,
    auth: PathBuf,
    catalog: PathBuf,
    claude_auth: PathBuf,
    providers: PathBuf,
    sessions: PathBuf,
}

impl Storage {
    /// Creates storage paths under the AIChat app data directory.
    pub fn new(paths: &AppPaths) -> Result<Self> {
        fs::create_dir_all(&paths.data_dir).context("Could not create app data directory")?;
        Ok(Self {
            settings: paths.settings.clone(),
            auth: paths.auth.clone(),
            catalog: paths.catalog.clone(),
            claude_auth: paths.claude_auth.clone(),
            providers: paths.providers.clone(),
            sessions: paths.sessions.clone(),
        })
    }

    /// Loads persisted application settings or defaults.
    pub fn load_settings(&self) -> Result<AppSettings> {
        read_pretty_or_default(&self.settings, "settings")
    }

    /// Saves application settings as formatted JSON.
    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        write_pretty(&self.settings, settings, "settings")
    }

    /// Loads persisted Codex authentication or defaults.
    pub fn load_auth(&self) -> Result<AuthStorage> {
        read_pretty_or_default(&self.auth, "codex-auth")
    }

    /// Saves Codex authentication as formatted JSON.
    pub fn save_auth(&self, auth: &AuthStorage) -> Result<()> {
        write_pretty(&self.auth, auth, "codex-auth")
    }

    /// Loads persisted Codex catalog or defaults.
    pub fn load_catalog(&self) -> Result<CatalogStorage> {
        read_pretty_or_default(&self.catalog, "codex-catalog")
    }

    /// Saves Codex catalog as formatted JSON.
    pub fn save_catalog(&self, catalog: &CatalogStorage) -> Result<()> {
        write_pretty(&self.catalog, catalog, "codex-catalog")
    }

    /// Loads persisted Claude authentication or defaults.
    pub fn load_claude_auth(&self) -> Result<ClaudeCredential> {
        read_pretty_or_default(&self.claude_auth, "claude-auth")
    }

    /// Saves Claude authentication as formatted JSON.
    pub fn save_claude_auth(&self, auth: &ClaudeCredential) -> Result<()> {
        write_pretty(&self.claude_auth, auth, "claude-auth")
    }

    /// Loads stored providers or an empty provider list.
    pub fn load_providers(&self) -> Result<ProviderStorage> {
        read_pretty_or_default(&self.providers, "providers")
    }

    /// Saves stored providers as formatted JSON.
    pub fn save_providers(&self, providers: &ProviderStorage) -> Result<()> {
        write_pretty(&self.providers, providers, "providers")
    }

    /// Loads local chat sessions or an empty session list.
    pub fn load_sessions(&self) -> Result<Vec<ChatSession>> {
        read_pretty_or_default(&self.sessions, "sessions")
    }

    /// Saves local chat sessions, trimming to the configured history limit.
    pub fn save_sessions(&self, sessions: &[ChatSession]) -> Result<()> {
        let start = sessions.len().saturating_sub(SESSION_LIMIT);
        write_pretty(&self.sessions, &sessions[start..], "sessions")
    }
}

/// Reads formatted JSON and falls back to the type default when missing.
fn read_pretty_or_default<T>(path: &Path, label: &str) -> Result<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let text = fs::read_to_string(path).with_context(|| format!("Could not read {label}.json"))?;
    let text = text.trim_start_matches('\u{feff}');
    serde_json::from_str(text).with_context(|| format!("Could not parse {label}.json"))
}

/// Writes formatted JSON to disk with contextual errors.
fn write_pretty<T>(path: &Path, value: &T, label: &str) -> Result<()>
where
    T: serde::Serialize + ?Sized,
{
    let text = serde_json::to_string_pretty(value)
        .with_context(|| format!("Could not serialize {label}"))?;
    fs::write(path, text).with_context(|| format!("Could not write {}", path.display()))
}
