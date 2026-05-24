//! Application layer: state management, Tauri commands, and UI events.

mod commands;
mod events;
pub mod state;
mod view;

pub use commands::{
    app_get_snapshot, auth_sign_out, auth_start_login, catalog_refresh_limits,
    catalog_refresh_models, chat_send, chat_stop, clipboard_write_text, link_open, session_create,
    session_delete, session_select, settings_update, window_set_pinned,
};
pub use state::AppState;
