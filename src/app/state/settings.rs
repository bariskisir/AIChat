//! Settings mutation helpers for shared application state.

use super::AppState;
use crate::app::view::{AppSnapshot, SettingsInput};
use crate::domain::{
    MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH,
    is_minimized_window_position,
};
use anyhow::Result;

impl AppState {
    /// Applies user-editable settings and persists them with the active session.
    pub fn update_settings(&self, input: SettingsInput) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.settings.model = input.model;
        inner.settings.compact_mode = input.compact_mode;
        inner.settings.reasoning_effort = normalize_reasoning_effort(&input.reasoning_effort);
        inner.settings.thinking_variant = inner.catalog.normalize_thinking_variant(
            &input.thinking_variant,
            &active_model_id(&inner.settings.model),
        );
        inner.settings.verbosity = inner
            .catalog
            .normalize_verbosity(&input.verbosity, &active_model_id(&inner.settings.model));
        inner.settings.extended_thinking = input.extended_thinking;
        inner.settings.claude_effort = normalize_claude_effort(&input.claude_effort);
        inner.settings.always_on_top = input.always_on_top;
        inner.save_active_session_model_settings()?;
        if let Some(width) = input.window_width {
            inner.settings.window_width = width.max(MIN_WINDOW_WIDTH);
        }
        if let Some(height) = input.window_height {
            inner.settings.window_height = height.max(MIN_WINDOW_HEIGHT);
        }
        if let Some(width) = input.sidebar_width {
            inner.settings.sidebar_width = width.clamp(MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        }
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Persists the current window size after enforcing minimum dimensions.
    pub fn save_window_size(&self, width: u32, height: u32) -> Result<()> {
        let mut inner = self.lock()?;
        let w = width.max(MIN_WINDOW_WIDTH);
        let h = height.max(MIN_WINDOW_HEIGHT);
        if inner.settings.window_width == w && inner.settings.window_height == h {
            return Ok(());
        }
        inner.settings.window_width = w;
        inner.settings.window_height = h;
        inner.storage.save_settings(&inner.settings)?;
        Ok(())
    }

    /// Persists the current window position.
    pub fn save_window_position(&self, x: i32, y: i32) -> Result<()> {
        if is_minimized_window_position(x, y) {
            return Ok(());
        }
        let mut inner = self.lock()?;
        if inner.settings.window_x == Some(x) && inner.settings.window_y == Some(y) {
            return Ok(());
        }
        inner.settings.window_x = Some(x);
        inner.settings.window_y = Some(y);
        inner.storage.save_settings(&inner.settings)?;
        Ok(())
    }

    /// Persists and returns the always-on-top setting.
    pub fn set_window_pinned(&self, enabled: bool) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.settings.always_on_top = enabled;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }
}

/// Keeps reasoning effort within supported OpenAI-compatible values.
fn normalize_reasoning_effort(value: &str) -> String {
    match value {
        "low" | "medium" | "high" => value.to_owned(),
        _ => "none".to_owned(),
    }
}

/// Keeps Claude effort within supported values.
fn normalize_claude_effort(value: &str) -> String {
    match value {
        "low" | "medium" | "high" => value.to_owned(),
        _ => "high".to_owned(),
    }
}

/// Returns the model id from a provider/model selection key.
fn active_model_id(model_key: &str) -> String {
    crate::domain::split_model_key(model_key)
        .map(|(_, model)| model.to_owned())
        .unwrap_or_else(|| model_key.to_owned())
}
