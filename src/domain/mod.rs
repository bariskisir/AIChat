//! Domain models and constants for AI Chat.

mod catalog;
mod claude;
pub mod codex;
mod sessions;
mod settings;

pub use catalog::*;
pub use claude::*;
pub use codex::*;
pub use sessions::*;
pub use settings::*;

pub const SESSION_LIMIT: usize = 100;
pub const MESSAGE_CONTEXT_LIMIT: usize = 40;
pub const CODEX_PROVIDER_URL: &str = "codex://chatgpt";
pub const CLAUDE_PROVIDER_URL: &str = "claude://claude.ai";
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.5";
pub const DEFAULT_THINKING_VARIANT: &str = "high";
pub const DEFAULT_VERBOSITY_SETTING: &str = "default";
pub const DEFAULT_VERBOSITY: &str = "medium";
pub const DEFAULT_CODEX_CLIENT_VERSION: &str = "0.135.0";
pub const TITLE_RESPONSE_STYLE: &str = "low";
