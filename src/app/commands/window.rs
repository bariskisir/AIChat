//! Window, clipboard, external-link, and update-check command handlers.

use super::CmdResult;
use crate::app::state::AppState;
use crate::infra::{clipboard, update};
use tauri::State;

/// Copies text through the native clipboard command path.
#[tauri::command]
pub fn clipboard_write_text(text: String) -> CmdResult<()> {
    if text.is_empty() {
        return Ok(());
    }
    clipboard::write_text(&text).map_err(|e| e.to_string())
}

/// Opens a known external link target in the default browser.
#[tauri::command]
pub fn link_open(target: String, state: State<'_, AppState>) -> CmdResult<()> {
    state.open_link(&target).map_err(|e| e.to_string())
}

/// Checks for updates and returns the result.
#[tauri::command]
pub async fn check_update(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    let current_version = state.app_version();
    let result = update::check_for_update(&current_version).await;
    Ok(serde_json::json!({
        "hasUpdate": result.has_update,
        "latestVersion": result.latest_version,
        "currentVersion": current_version,
        "errorMessage": result.error_message,
    }))
}
