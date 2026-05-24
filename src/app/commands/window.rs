//! Window, clipboard, and external-link command handlers.

use super::CmdResult;
use crate::app::state::AppState;
use crate::app::view::AppSnapshot;
use crate::infra::clipboard;
use tauri::{AppHandle, Manager, State};

/// Copies text through the native clipboard command path.
#[tauri::command]
pub fn clipboard_write_text(text: String, app_handle: AppHandle) -> CmdResult<()> {
    if text.is_empty() {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "Main window was not found.".to_owned())?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        clipboard::write_text(&text, hwnd).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        clipboard::write_text(&text).map_err(|e| e.to_string())
    }
}

/// Persists the always-on-top window setting.
#[tauri::command]
pub fn window_set_pinned(
    enabled: bool,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> CmdResult<AppSnapshot> {
    let snapshot = state
        .set_window_pinned(enabled)
        .map_err(|e| e.to_string())?;
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window was not found.".to_owned())?;
    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())?;
    Ok(snapshot)
}

/// Opens a known external link target in the default browser.
#[tauri::command]
pub fn link_open(target: String, state: State<'_, AppState>) -> CmdResult<()> {
    state.open_link(&target).map_err(|e| e.to_string())
}
