//! Tauri command handlers.

mod providers;
mod sessions;
mod window;

pub use providers::{
    app_get_snapshot, catalog_refresh_models, provider_delete, provider_refresh_models,
    provider_save, settings_update,
};
pub use sessions::{chat_send, chat_stop, session_create, session_delete, session_select};
pub use window::{clipboard_write_text, link_open, window_set_pinned};

type CmdResult<T> = std::result::Result<T, String>;
