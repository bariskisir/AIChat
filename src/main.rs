//! Starts the Tauri desktop AI Chat application.

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app;
mod domain;
mod infra;

use anyhow::Result;
use app::{
    AppState, app_get_snapshot, catalog_refresh_models, chat_send, chat_stop, clipboard_write_text,
    link_open, provider_delete, provider_refresh_models, provider_save, session_create,
    session_delete, session_select, settings_update, window_set_pinned,
};
use infra::paths::app_paths;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size, WindowEvent};

/// Boots the Tauri application, restores window state, and registers commands.
fn main() -> Result<()> {
    let paths = app_paths()?;
    infra::logging::install_logger(paths.log_file.clone())?;
    log::info!(
        "AI Chat application starting; data_dir={}",
        paths.data_dir.display()
    );
    let state = AppState::new(paths)?;
    let managed_state = state.clone();

    tauri::Builder::default()
        .manage(managed_state)
        .setup(move |app| {
            let app_version = app.package_info().version.to_string();
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("AI Chat - v{app_version}"))?;
                if let Ok(snapshot) = state.snapshot() {
                    let size = PhysicalSize::new(
                        snapshot.settings.window_width,
                        snapshot.settings.window_height,
                    );
                    if let Err(error) = window.set_size(Size::Physical(size)) {
                        log::warn!("Could not restore saved window size: {error}");
                    }
                    if let (Some(x), Some(y)) =
                        (snapshot.settings.window_x, snapshot.settings.window_y)
                    {
                        let position = PhysicalPosition::new(x, y);
                        if let Err(error) = window.set_position(Position::Physical(position)) {
                            log::warn!("Could not restore saved window position: {error}");
                        }
                    }
                    if let Err(error) = window.set_always_on_top(snapshot.settings.always_on_top) {
                        log::warn!("Could not apply always-on-top setting: {error}");
                    }
                }
                let window_state = state.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Resized(size) = event
                        && let Err(error) = window_state.save_window_size(size.width, size.height)
                    {
                        log::warn!("Could not save resized window size: {error}");
                    }
                    if let WindowEvent::Moved(position) = event
                        && let Err(error) =
                            window_state.save_window_position(position.x, position.y)
                    {
                        log::warn!("Could not save moved window position: {error}");
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_get_snapshot,
            settings_update,
            provider_save,
            provider_delete,
            catalog_refresh_models,
            provider_refresh_models,
            session_create,
            session_select,
            session_delete,
            chat_send,
            chat_stop,
            clipboard_write_text,
            window_set_pinned,
            link_open
        ])
        .run(tauri::generate_context!())
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    log::info!("AI Chat application stopped");
    Ok(())
}
