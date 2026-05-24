//! Domain models and constants for ChatGPT Codex.

mod catalog;
mod sessions;
mod settings;

pub use catalog::*;
pub use sessions::*;
pub use settings::*;

pub const DEFAULT_MODEL: &str = "gpt-5.5";
pub const DEFAULT_THINKING_VARIANT: &str = "high";
pub const DEFAULT_CODEX_CLIENT_VERSION: &str = "0.133.0";
pub const CHAT_RESPONSE_STYLE: &str = "medium";
pub const TITLE_RESPONSE_STYLE: &str = "low";
pub const SESSION_LIMIT: usize = 100;
pub const MESSAGE_CONTEXT_LIMIT: usize = 40;
