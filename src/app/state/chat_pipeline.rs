//! Shared chat response pipeline — eliminates duplicated spawn/execute/error-handling
//! boilerplate across the OpenAI, Codex, and Claude backends.

use super::AppState;
use crate::app::events::UiEvent;
use crate::app::view::AppSnapshot;
use std::future::Future;
use tauri::{AppHandle, Emitter};

/// Spawns a chat streaming task with standard Ok/Err lifecycle handling.
///
/// On success the snapshot is emitted to the frontend. On failure the assistant
/// placeholder is cleaned up and the error is forwarded.
pub(in crate::app::state) fn spawn_chat_stream(
    state: &AppState,
    session_id: String,
    assistant_message_id: String,
    app_handle: AppHandle,
    future: impl Future<Output = Result<AppSnapshot, anyhow::Error>> + Send + 'static,
) {
    let state_clone = state.clone();
    let sid = session_id.clone();
    let mid = assistant_message_id.clone();

    let abort_handle = state
        .runtime
        .spawn(async move {
            match future.await {
                Ok(snapshot) => {
                    let _ = app_handle.emit(
                        "app-event",
                        UiEvent::Snapshot {
                            snapshot: Box::new(snapshot),
                        },
                    );
                }
                Err(error) => {
                    state_clone.finish_failed_assistant_placeholder(&sid, &mid);
                    state_clone.emit_error_snapshot(&app_handle, error);
                }
            }
        })
        .abort_handle();

    state.register_active_chat_response(session_id, assistant_message_id, abort_handle);
}

/// Spawns a hidden title-generation task. Results are emitted to the frontend
/// only when a title is successfully generated.
pub(in crate::app::state) fn spawn_title_stream(
    state: &AppState,
    app_handle: AppHandle,
    future: impl Future<Output = Result<(String, String), anyhow::Error>> + Send + 'static,
) {
    state.runtime.spawn(async move {
        if let Ok((session_id, title)) = future.await {
            AppState::emit_session_title_event(&app_handle, session_id, title);
        }
    });
}
