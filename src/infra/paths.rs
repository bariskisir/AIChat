//! Application path helpers.

use anyhow::{Context, Result};
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub settings: PathBuf,
    pub auth: PathBuf,
    pub catalog: PathBuf,
    pub sessions: PathBuf,
    pub log_file: PathBuf,
}

const APP_DATA_DIR: &str = "ChatGPTCodex";

/// Resolves and creates the application data paths.
pub fn app_paths() -> Result<AppPaths> {
    let data_root = dirs::data_dir().context("Could not resolve user data directory")?;
    let data_dir = data_root.join(APP_DATA_DIR);
    std::fs::create_dir_all(&data_dir).context("Could not create app data directory")?;
    Ok(AppPaths {
        settings: data_dir.join("settings.json"),
        auth: data_dir.join("auth.json"),
        catalog: data_dir.join("catalog.json"),
        sessions: data_dir.join("sessions.json"),
        log_file: data_dir.join("app.log"),
        data_dir,
    })
}
