//! Tauri command handlers.

mod account;
mod sessions;
mod window;

pub use account::{
    app_get_snapshot, auth_sign_out, auth_start_login, catalog_refresh_limits,
    catalog_refresh_models, settings_update,
};
pub use sessions::{chat_send, chat_stop, session_create, session_delete, session_select};
pub use window::{clipboard_write_text, link_open, window_set_pinned};

type CmdResult<T> = std::result::Result<T, String>;
