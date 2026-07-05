//! Starts the Tauri desktop AI Chat application.

#![forbid(unsafe_code)]
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app;
mod domain;
mod infra;

use anyhow::Result;
use app::{
    AppState, app_get_snapshot, catalog_refresh_models, chat_send, chat_stop,
    check_update, claude_auth_sign_out, claude_auth_start_login, clipboard_write_text, link_open,
    provider_delete, provider_refresh_models, provider_save, session_create, session_delete,
    session_select, settings_update,
};
use domain::is_minimized_window_position;
use infra::paths::app_paths;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size, WindowEvent};

/// Boots the Tauri application and registers commands.
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
        .plugin(tauri_plugin_notification::init())
        .manage(managed_state)
        .setup(move |app| {
            let app_version = app.package_info().version.to_string();
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("AI Chat - v{app_version}"))?;
                if let Ok(snapshot) = state.snapshot() {
                    if let (Some(width), Some(height)) = (
                        snapshot.settings.window.width,
                        snapshot.settings.window.height,
                    ) && let Err(error) =
                        window.set_size(Size::Physical(PhysicalSize::new(width, height)))
                    {
                        log::warn!("Could not restore saved window size: {error}");
                    }
                    if let (Some(x), Some(y)) =
                        (snapshot.settings.window.x, snapshot.settings.window.y)
                        && !is_minimized_window_position(x, y)
                        && let Err(error) =
                            window.set_position(Position::Physical(PhysicalPosition::new(x, y)))
                    {
                        log::warn!("Could not restore saved window position: {error}");
                    }
                    if snapshot.settings.window.fullscreen {
                        if let Err(error) = window.set_fullscreen(true) {
                            log::warn!("Could not restore fullscreen window state: {error}");
                        }
                    } else if snapshot.settings.window.maximized
                        && let Err(error) = window.maximize()
                    {
                        log::warn!("Could not restore maximized window state: {error}");
                    }
                }
                state.start_claude_code_bootstrap(app.handle().clone());
                state.start_codex_bootstrap(app.handle().clone());

                if state.check_updates_on_startup() {
                    state.spawn_update_check(app.handle().clone());
                }

                let window_state = state.clone();
                let tracked_window = window.clone();
                window.on_window_event(move |event| {
                    if !matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
                        return;
                    }
                    if tracked_window.is_minimized().unwrap_or(false) {
                        return;
                    }
                    let Ok(size) = tracked_window.outer_size() else {
                        return;
                    };
                    let Ok(position) = tracked_window.outer_position() else {
                        return;
                    };
                    let maximized = tracked_window.is_maximized().unwrap_or(false);
                    let fullscreen = tracked_window.is_fullscreen().unwrap_or(false);
                    if let Err(error) = window_state.save_window_state(
                        size.width,
                        size.height,
                        position.x,
                        position.y,
                        maximized,
                        fullscreen,
                    ) {
                        log::warn!("Could not save window state: {error}");
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_get_snapshot,
            settings_update,
            claude_auth_start_login,
            claude_auth_sign_out,
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
            link_open,
            check_update
        ])
        .run(tauri::generate_context!())
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    log::info!("AI Chat application stopped");
    Ok(())
}
