//! Account and settings command handlers exposed to the frontend.

use super::CmdResult;
use crate::app::state::AppState;
use crate::app::view::{AppSnapshot, SettingsInput};
use tauri::{AppHandle, State};

#[tauri::command]
/// Returns the current application snapshot.
pub fn app_get_snapshot(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.snapshot().map_err(|e| e.to_string())
}

#[tauri::command]
/// Persists settings received from the frontend.
pub fn settings_update(
    settings: SettingsInput,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    state.update_settings(settings).map_err(|e| e.to_string())
}

#[tauri::command]
/// Starts the browser-based Claude sign-in flow.
pub fn auth_start_login(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> CmdResult<AppSnapshot> {
    state.start_login(app_handle).map_err(|e| e.to_string())
}

#[tauri::command]
/// Clears stored Claude authentication state.
pub fn auth_sign_out(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.sign_out().map_err(|e| e.to_string())
}

#[tauri::command]
/// Refreshes the Claude model catalog for the signed-in account.
pub async fn catalog_refresh_models(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.refresh_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
/// Refreshes usage-limit status when supported by the backend.
pub fn catalog_refresh_limits(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.refresh_limits().map_err(|e| e.to_string())
}
