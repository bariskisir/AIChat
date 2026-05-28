//! Domain models and constants for ClaudeChat.

mod catalog;
mod sessions;
mod settings;

pub use catalog::*;
pub use sessions::*;
pub use settings::*;

pub const SESSION_LIMIT: usize = 100;
pub const MESSAGE_CONTEXT_LIMIT: usize = 40;
