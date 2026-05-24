//! JSON file persistence for settings, auth, model catalog, and chat sessions.

use crate::domain::{AppSettings, AuthStorage, CatalogStorage, ChatSession, SESSION_LIMIT};
use crate::infra::paths::AppPaths;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Storage {
    settings: PathBuf,
    auth: PathBuf,
    catalog: PathBuf,
    sessions: PathBuf,
}

impl Storage {
    /// Initializes storage paths and creates the app data directory.
    pub fn new(paths: &AppPaths) -> Result<Self> {
        fs::create_dir_all(&paths.data_dir).context("Could not create app data directory")?;
        Ok(Self {
            settings: paths.settings.clone(),
            auth: paths.auth.clone(),
            catalog: paths.catalog.clone(),
            sessions: paths.sessions.clone(),
        })
    }

    /// Loads persisted application settings or returns defaults.
    pub fn load_settings(&self) -> Result<AppSettings> {
        read_pretty_or_default(&self.settings, "settings")
    }

    /// Saves application settings as pretty-printed JSON.
    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        write_pretty(&self.settings, settings, "settings")
    }

    /// Loads persisted ChatGPT authentication or returns defaults.
    pub fn load_auth(&self) -> Result<AuthStorage> {
        read_pretty_or_default(&self.auth, "auth")
    }

    /// Saves ChatGPT authentication as pretty-printed JSON.
    pub fn save_auth(&self, auth: &AuthStorage) -> Result<()> {
        write_pretty(&self.auth, auth, "auth")
    }

    /// Loads the persisted model catalog or returns fallback models.
    pub fn load_catalog(&self) -> Result<CatalogStorage> {
        read_pretty_or_default(&self.catalog, "catalog")
    }

    /// Saves the model catalog as pretty-printed JSON.
    pub fn save_catalog(&self, catalog: &CatalogStorage) -> Result<()> {
        write_pretty(&self.catalog, catalog, "catalog")
    }

    /// Loads persisted chat sessions or returns an empty list.
    pub fn load_sessions(&self) -> Result<Vec<ChatSession>> {
        read_pretty_or_default(&self.sessions, "sessions")
    }

    /// Saves the newest chat sessions as pretty-printed JSON.
    pub fn save_sessions(&self, sessions: &[ChatSession]) -> Result<()> {
        let start = sessions.len().saturating_sub(SESSION_LIMIT);
        write_pretty(&self.sessions, &sessions[start..], "sessions")
    }
}

/// Loads pretty-printed JSON or returns a default value when missing.
fn read_pretty_or_default<T>(path: &Path, label: &str) -> Result<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let text = fs::read_to_string(path).with_context(|| format!("Could not read {label}.json"))?;
    serde_json::from_str(&text).with_context(|| format!("Could not parse {label}.json"))
}

/// Writes a serializable value as pretty-printed JSON.
fn write_pretty<T>(path: &Path, value: &T, label: &str) -> Result<()>
where
    T: serde::Serialize + ?Sized,
{
    let text = serde_json::to_string_pretty(value)
        .with_context(|| format!("Could not serialize {label}"))?;
    fs::write(path, text).with_context(|| format!("Could not write {}", path.display()))
}
