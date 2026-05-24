//! Account and settings command handlers exposed to the frontend.

use super::CmdResult;
use crate::app::state::AppState;
use crate::app::view::{AppSnapshot, SettingsInput};
use tauri::{AppHandle, State};

/// Returns the current application snapshot to the frontend.
#[tauri::command]
pub fn app_get_snapshot(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.snapshot().map_err(|error| error.to_string())
}

/// Persists frontend settings and returns the refreshed snapshot.
#[tauri::command]
pub fn settings_update(
    settings: SettingsInput,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    state
        .update_settings(settings)
        .map_err(|error| error.to_string())
}

/// Starts the ChatGPT OAuth sign-in flow.
#[tauri::command]
pub fn auth_start_login(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> CmdResult<AppSnapshot> {
    state
        .start_login(app_handle)
        .map_err(|error| error.to_string())
}

/// Clears stored ChatGPT authentication state.
#[tauri::command]
pub fn auth_sign_out(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.sign_out().map_err(|error| error.to_string())
}

/// Fetches the latest ChatGPT model catalog for the signed-in account.
#[tauri::command]
pub fn catalog_refresh_models(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.refresh_models().map_err(|error| error.to_string())
}

/// Refreshes the displayed ChatGPT usage-limit label.
#[tauri::command]
pub fn catalog_refresh_limits(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.refresh_limits().map_err(|error| error.to_string())
}
