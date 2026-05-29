//! Application settings persisted for AI Chat.

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
    #[serde(default)]
    pub active_session_id: String,
    #[serde(default)]
    pub compact_mode: bool,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String,
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
    /// Provides first-run settings before any provider model catalog has loaded.
    fn default() -> Self {
        Self {
            model: String::new(),
            active_session_id: String::new(),
            compact_mode: false,
            reasoning_effort: default_reasoning_effort(),
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

/// Keeps legacy settings deserialization from selecting a hardcoded model.
fn default_model() -> String {
    String::new()
}
/// Disables reasoning_effort by default.
fn default_reasoning_effort() -> String {
    "none".to_owned()
}
/// Supplies the initial window width for persisted settings.
fn default_window_width() -> u32 {
    DEFAULT_WINDOW_WIDTH
}
/// Supplies the initial window height for persisted settings.
fn default_window_height() -> u32 {
    DEFAULT_WINDOW_HEIGHT
}
/// Supplies the initial sidebar width for persisted settings.
fn default_sidebar_width() -> u32 {
    DEFAULT_SIDEBAR_WIDTH
}
