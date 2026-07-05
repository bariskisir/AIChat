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
    #[serde(default)]
    pub model_settings: ModelSettings,
    #[serde(default)]
    pub visual: VisualSettings,
    #[serde(default)]
    pub updates: UpdateSettings,
    #[serde(default)]
    pub window: WindowState,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettings {
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
    #[serde(default)]
    pub title_gen_model: String,
    #[serde(default)]
    pub favorite_models: Vec<String>,
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            reasoning_effort: super::default_reasoning_effort(),
            thinking_variant: super::default_thinking_variant(),
            verbosity: super::default_verbosity_setting(),
            extended_thinking: default_extended_thinking(),
            claude_effort: super::default_claude_effort(),
            title_gen_model: String::new(),
            favorite_models: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualSettings {
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_show_info_bar")]
    pub show_info_bar: bool,
    #[serde(default = "default_show_model_bar")]
    pub show_model_bar: bool,
    #[serde(default = "default_markdown_enabled")]
    pub markdown_enabled: bool,
}

impl Default for VisualSettings {
    fn default() -> Self {
        Self {
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
            show_info_bar: true,
            show_model_bar: true,
            markdown_enabled: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    #[serde(default = "default_check_on_startup")]
    pub check_on_startup: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            check_on_startup: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub fullscreen: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: None,
            height: None,
            x: None,
            y: None,
            maximized: false,
            fullscreen: false,
        }
    }
}

impl Default for AppSettings {
    /// Provides first-run settings before any provider model catalog has loaded.
    fn default() -> Self {
        Self {
            model: String::new(),
            active_session_id: String::new(),
            model_settings: ModelSettings::default(),
            visual: VisualSettings::default(),
            updates: UpdateSettings::default(),
            window: WindowState::default(),
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

/// Supplies the default show-info-bar setting.
fn default_show_info_bar() -> bool {
    true
}

/// Shows the model toolbar by default.
fn default_show_model_bar() -> bool {
    true
}

/// Enables update check on startup by default.
fn default_check_on_startup() -> bool {
    true
}

fn default_markdown_enabled() -> bool {
    true
}

/// Detects Windows' minimized-window off-screen position sentinel.
pub fn is_minimized_window_position(x: i32, y: i32) -> bool {
    x <= MINIMIZED_WINDOW_POSITION_SENTINEL || y <= MINIMIZED_WINDOW_POSITION_SENTINEL
}
