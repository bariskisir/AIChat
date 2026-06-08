//! Domain models and constants for AI Chat.

mod catalog;
mod claude;
mod claudecode;
pub mod codex;
pub mod error;
pub mod messages;
mod providers;
mod sessions;
mod settings;

pub use catalog::*;
pub use claude::*;
pub use claudecode::*;
pub use codex::*;
pub use error::AppError;
pub use providers::*;
pub use sessions::*;
pub use settings::*;

pub const SESSION_LIMIT: usize = 100;
pub const MESSAGE_CONTEXT_LIMIT: usize = 40;
pub const CODEX_PROVIDER_URL: &str = "codex://chatgpt";
pub const CLAUDE_PROVIDER_URL: &str = "claude://claude.ai";
pub const CLAUDE_CODE_PROVIDER_URL: &str = "claudecode://anthropic";
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.5";
pub const DEFAULT_THINKING_VARIANT: &str = messages::LABEL_THINKING_HIGH;
pub const DEFAULT_VERBOSITY_SETTING: &str = "default";
pub const DEFAULT_VERBOSITY: &str = messages::LABEL_THINKING_HIGH;
pub const DEFAULT_CODEX_CLIENT_VERSION: &str = "0.138.0";
pub const TITLE_RESPONSE_STYLE: &str = messages::LABEL_THINKING_HIGH;

/// Uses the highest OpenAI-compatible reasoning effort by default.
pub fn default_reasoning_effort() -> String {
    messages::LABEL_THINKING_HIGH.to_owned()
}

/// Supplies the highest Codex verbosity setting by default.
pub fn default_verbosity_setting() -> String {
    DEFAULT_VERBOSITY.to_owned()
}

/// Supplies the default Claude effort setting.
pub fn default_claude_effort() -> String {
    messages::CLAUDE_EFFORT_DEFAULT.to_owned()
}

/// Returns the model id from a provider/model selection key.
pub fn active_model_id(model_key: &str) -> String {
    split_model_key(model_key)
        .map(|(_, model)| model.to_owned())
        .unwrap_or_else(|| model_key.to_owned())
}

/// The kind of AI provider, determined by its API URL.
#[derive(Debug, Clone, PartialEq)]
pub enum ProviderKind {
    OpenAi,
    Codex,
    Claude,
    ClaudeCode,
}
