//! Settings mutation helpers for shared application state.

use super::AppState;
use crate::app::view::{AppSnapshot, SettingsInput};
use crate::domain::{
    MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH,
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
        inner.settings.show_footer = input.show_footer;
        inner.settings.show_info_bar = input.show_info_bar;
        inner.settings.show_model_bar = input.show_model_bar;
        inner.settings.title_gen_model = input.title_gen_model;
        inner.settings.favorite_models = normalize_favorite_models(input.favorite_models);
        inner.save_active_session_model_settings()?;
        if let Some(width) = input.sidebar_width {
            inner.settings.sidebar_width = width.clamp(MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        }
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Persists the native window state without overwriting normal bounds while maximized.
    pub fn save_window_state(
        &self,
        width: u32,
        height: u32,
        x: i32,
        y: i32,
        maximized: bool,
        fullscreen: bool,
    ) -> Result<()> {
        let mut inner = self.lock()?;
        let mut changed = inner.settings.window_maximized != maximized
            || inner.settings.window_fullscreen != fullscreen;

        inner.settings.window_maximized = maximized;
        inner.settings.window_fullscreen = fullscreen;

        if !maximized
            && !fullscreen
            && width > 0
            && height > 0
            && !crate::domain::is_minimized_window_position(x, y)
        {
            changed |= inner.settings.window_width != Some(width)
                || inner.settings.window_height != Some(height)
                || inner.settings.window_x != Some(x)
                || inner.settings.window_y != Some(y);
            inner.settings.window_width = Some(width);
            inner.settings.window_height = Some(height);
            inner.settings.window_x = Some(x);
            inner.settings.window_y = Some(y);
        }

        if changed {
            inner.storage.save_settings(&inner.settings)?;
        }
        Ok(())
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
