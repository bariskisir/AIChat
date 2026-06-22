//! Window, clipboard, and external-link command handlers.

use super::CmdResult;
use crate::app::state::AppState;
use crate::infra::clipboard;
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
