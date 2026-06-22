//! Application settings persisted for AI Chat.

use serde::{Deserialize, Serialize};

pub const DEFAULT_SIDEBAR_WIDTH: u32 = 115;
pub const MIN_SIDEBAR_WIDTH: u32 = 80;
pub const MAX_SIDEBAR_WIDTH: u32 = 360;
pub const MINIMIZED_WINDOW_POSITION_SENTINEL: i32 = -30000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub active_session_id: String,
    #[serde(default = "super::default_reasoning_effort")]
    pub reasoning_effort: String,
    #[serde(default = "super::default_thinking_variant")]
    pub thinking_variant: String,
    #[serde(default = "super::default_verbosity_setting")]
    pub verbosity: String,
    #[serde(default = "default_extended_thinking")]
    pub extended_thinking: bool,
    #[serde(default = "super::default_claude_effort")]
    pub claude_effort: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_x: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_y: Option<i32>,
    #[serde(default)]
    pub window_maximized: bool,
    #[serde(default)]
    pub window_fullscreen: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_show_footer")]
    pub show_footer: bool,
    #[serde(default = "default_show_info_bar")]
    pub show_info_bar: bool,
    #[serde(default = "default_show_model_bar")]
    pub show_model_bar: bool,
    #[serde(default)]
    pub title_gen_model: String,
    #[serde(default)]
    pub favorite_models: Vec<String>,
}

impl Default for AppSettings {
    /// Provides first-run settings before any provider model catalog has loaded.
    fn default() -> Self {
        Self {
            model: String::new(),
            active_session_id: String::new(),
            reasoning_effort: super::default_reasoning_effort(),
            thinking_variant: super::default_thinking_variant(),
            verbosity: super::default_verbosity_setting(),
            extended_thinking: default_extended_thinking(),
            claude_effort: super::default_claude_effort(),
            window_width: None,
            window_height: None,
            window_x: None,
            window_y: None,
            window_maximized: false,
            window_fullscreen: false,
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
            show_footer: true,
            show_info_bar: true,
            show_model_bar: true,
            title_gen_model: String::new(),
            favorite_models: Vec::new(),
        }
    }
}

/// Keeps legacy settings deserialization from selecting a hardcoded model.
fn default_model() -> String {
    String::new()
}

/// Enables Claude extended thinking by default.
pub fn default_extended_thinking() -> bool {
    true
}

/// Supplies the initial sidebar width for persisted settings.
fn default_sidebar_width() -> u32 {
    DEFAULT_SIDEBAR_WIDTH
}

/// Supplies the default show-footer setting.
fn default_show_footer() -> bool {
    true
}

/// Supplies the default show-info-bar setting.
fn default_show_info_bar() -> bool {
    true
}

/// Shows the model toolbar by default.
fn default_show_model_bar() -> bool {
    true
}

/// Detects Windows' minimized-window off-screen position sentinel.
pub fn is_minimized_window_position(x: i32, y: i32) -> bool {
    x <= MINIMIZED_WINDOW_POSITION_SENTINEL || y <= MINIMIZED_WINDOW_POSITION_SENTINEL
}
