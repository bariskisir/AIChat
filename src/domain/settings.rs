//! Application settings persisted for ChatGPT Codex.

use super::{DEFAULT_MODEL, DEFAULT_THINKING_VARIANT, DEFAULT_VERBOSITY_SETTING};
use serde::{Deserialize, Serialize};

pub const DEFAULT_WINDOW_WIDTH: u32 = 800;
pub const DEFAULT_WINDOW_HEIGHT: u32 = 800;
pub const MIN_WINDOW_WIDTH: u32 = 700;
pub const MIN_WINDOW_HEIGHT: u32 = 500;
pub const DEFAULT_SIDEBAR_WIDTH: u32 = 115;
pub const MIN_SIDEBAR_WIDTH: u32 = 80;
pub const MAX_SIDEBAR_WIDTH: u32 = 360;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_thinking_variant")]
    pub thinking_variant: String,
    #[serde(default = "default_verbosity_setting")]
    pub verbosity: String,
    #[serde(default)]
    pub active_session_id: String,
    #[serde(default)]
    pub compact_mode: bool,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default = "default_window_width")]
    pub window_width: u32,
    #[serde(default = "default_window_height")]
    pub window_height: u32,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_x: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_y: Option<i32>,
    #[serde(default)]
    pub window_layout_initialized: bool,
}

impl Default for AppSettings {
    /// Builds the default application settings.
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_owned(),
            thinking_variant: DEFAULT_THINKING_VARIANT.to_owned(),
            verbosity: DEFAULT_VERBOSITY_SETTING.to_owned(),
            active_session_id: String::new(),
            compact_mode: false,
            always_on_top: false,
            window_width: DEFAULT_WINDOW_WIDTH,
            window_height: DEFAULT_WINDOW_HEIGHT,
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
            window_x: None,
            window_y: None,
            window_layout_initialized: true,
        }
    }
}

/// Returns the fallback ChatGPT model identifier.
fn default_model() -> String {
    DEFAULT_MODEL.to_owned()
}

/// Returns the fallback reasoning effort value.
fn default_thinking_variant() -> String {
    DEFAULT_THINKING_VARIANT.to_owned()
}

/// Returns the fallback verbosity setting value.
fn default_verbosity_setting() -> String {
    DEFAULT_VERBOSITY_SETTING.to_owned()
}

/// Returns the default native window width.
fn default_window_width() -> u32 {
    DEFAULT_WINDOW_WIDTH
}

/// Returns the default native window height.
fn default_window_height() -> u32 {
    DEFAULT_WINDOW_HEIGHT
}

/// Returns the default chat navigation sidebar width.
fn default_sidebar_width() -> u32 {
    DEFAULT_SIDEBAR_WIDTH
}
