//! Settings mutation helpers for shared application state.

use super::AppState;
use crate::app::view::{AppSnapshot, SettingsInput};
use crate::domain::{
    MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH,
    is_minimized_window_position,
    messages::{
        CLAUDE_EFFORT_DEFAULT, LABEL_NONE, LABEL_THINKING_HIGH, LABEL_THINKING_LOW,
        LABEL_THINKING_MAX, LABEL_THINKING_MEDIUM, LABEL_THINKING_XHIGH,
    },
};
use anyhow::Result;
use std::collections::HashSet;

impl AppState {
    /// Applies user-editable settings and persists them with the active session.
    pub fn update_settings(&self, input: SettingsInput) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.settings.model = input.model;
        inner.settings.compact_mode = input.compact_mode;
        inner.settings.reasoning_effort = normalize_reasoning_effort(&input.reasoning_effort);
        inner.settings.thinking_variant = inner.catalog.normalize_thinking_variant(
            &input.thinking_variant,
            &crate::domain::active_model_id(&inner.settings.model),
        );
        inner.settings.verbosity = inner.catalog.normalize_verbosity(
            &input.verbosity,
            &crate::domain::active_model_id(&inner.settings.model),
        );
        inner.settings.extended_thinking = input.extended_thinking;
        inner.settings.claude_effort = normalize_claude_effort(&input.claude_effort);
        inner.settings.always_on_top = input.always_on_top;
        inner.settings.show_footer = input.show_footer;
        inner.settings.show_info_bar = input.show_info_bar;
        inner.settings.title_gen_model = input.title_gen_model;
        inner.settings.favorite_models = normalize_favorite_models(input.favorite_models);
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
        LABEL_THINKING_LOW | LABEL_THINKING_MEDIUM | LABEL_THINKING_HIGH => value.to_owned(),
        _ => LABEL_NONE.to_owned(),
    }
}

/// Keeps Claude effort within supported values.
fn normalize_claude_effort(value: &str) -> String {
    match value {
        LABEL_THINKING_LOW
        | LABEL_THINKING_MEDIUM
        | LABEL_THINKING_HIGH
        | LABEL_THINKING_XHIGH
        | LABEL_THINKING_MAX => value.to_owned(),
        _ => CLAUDE_EFFORT_DEFAULT.to_owned(),
    }
}

/// Removes empty and duplicate persisted model keys while preserving favorite order.
fn normalize_favorite_models(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::normalize_favorite_models;

    #[test]
    fn favorite_models_are_trimmed_and_deduplicated() {
        let favorites = normalize_favorite_models(vec![
            " provider/model ".to_owned(),
            String::new(),
            "provider/model".to_owned(),
            "other/model".to_owned(),
        ]);

        assert_eq!(favorites, vec!["provider/model", "other/model"]);
    }
}
