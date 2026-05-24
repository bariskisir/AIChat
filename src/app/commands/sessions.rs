//! Chat session command handlers exposed to the frontend.

use super::CmdResult;
use crate::app::state::AppState;
use crate::app::view::{AppSnapshot, SendMessageRequest};
use tauri::{AppHandle, State};

/// Creates a new chat session and selects it.
#[tauri::command]
pub fn session_create(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state.create_session().map_err(|error| error.to_string())
}

/// Selects an existing chat session.
#[tauri::command]
pub fn session_select(session_id: String, state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state
        .select_session(&session_id)
        .map_err(|error| error.to_string())
}

/// Deletes a chat session and selects a remaining or new session.
#[tauri::command]
pub fn session_delete(session_id: String, state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state
        .delete_session(&session_id)
        .map_err(|error| error.to_string())
}

/// Sends a user message in the active session.
#[tauri::command]
pub fn chat_send(
    input: SendMessageRequest,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> CmdResult<AppSnapshot> {
    state
        .send_message(input, app_handle)
        .map_err(|error| error.to_string())
}

/// Stops the currently streaming chat response.
#[tauri::command]
pub fn chat_stop(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    state
        .stop_chat_response()
        .map_err(|error| error.to_string())
}
