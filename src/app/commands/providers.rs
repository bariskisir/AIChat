//! Provider and settings command handlers exposed to the frontend.

use super::CmdResult;
use crate::app::state::AppState;
use crate::app::view::{AppSnapshot, ProviderInput, SettingsInput};
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
/// Starts the browser-based Claude.ai sign-in flow.
pub fn claude_auth_start_login(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> CmdResult<AppSnapshot> {
    state
        .start_claude_login(app_handle)
        .map_err(|e| e.to_string())
}

#[tauri::command]
/// Signs out of the Claude account used by the Claude provider.
pub fn claude_auth_sign_out(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.sign_out_claude().map_err(|e| e.to_string())
}

#[tauri::command]
/// Saves a provider and refreshes its models.
pub async fn provider_save(
    provider: ProviderInput,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    state
        .save_provider(provider)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
/// Deletes a provider.
pub fn provider_delete(provider_id: String, state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state
        .delete_provider(&provider_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
/// Refreshes every configured provider model catalog.
pub async fn catalog_refresh_models(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.refresh_all_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
/// Refreshes one configured provider model catalog.
pub async fn provider_refresh_models(
    provider_id: String,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    state
        .refresh_provider_models(&provider_id)
        .await
        .map_err(|e| e.to_string())
}
