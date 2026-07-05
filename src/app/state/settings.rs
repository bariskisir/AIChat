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
        inner.settings.model_settings.reasoning_effort =
            normalize_reasoning_effort(&input.reasoning_effort);
        let model_id = crate::domain::active_model_id(&inner.settings.model);
        let all_models = inner.providers.all_models();
        inner.settings.model_settings.thinking_variant = crate::domain::normalize_thinking_variant(
            &all_models,
            &input.thinking_variant,
            &model_id,
        );
        inner.settings.model_settings.verbosity = crate::domain::normalize_verbosity(
            &all_models,
            &input.verbosity,
            &model_id,
        );
        inner.settings.model_settings.extended_thinking = input.extended_thinking;
        inner.settings.model_settings.claude_effort =
            normalize_claude_effort(&input.claude_effort);
        inner.settings.visual.show_info_bar = input.show_info_bar;
        inner.settings.visual.show_model_bar = input.show_model_bar;
        inner.settings.visual.markdown_enabled = input.markdown_enabled;
        inner.settings.model_settings.title_gen_model = input.title_gen_model;
        inner.settings.model_settings.favorite_models =
            normalize_favorite_models(input.favorite_models);
        inner.settings.updates.check_on_startup = input.check_on_startup;
        inner.save_active_session_model_settings()?;
        if let Some(width) = input.sidebar_width {
            inner.settings.visual.sidebar_width =
                width.clamp(MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
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
        let mut changed = inner.settings.window.maximized != maximized
            || inner.settings.window.fullscreen != fullscreen;

        inner.settings.window.maximized = maximized;
        inner.settings.window.fullscreen = fullscreen;

        if !maximized
            && !fullscreen
            && width > 0
            && height > 0
            && !crate::domain::is_minimized_window_position(x, y)
        {
            changed |= inner.settings.window.width != Some(width)
                || inner.settings.window.height != Some(height)
                || inner.settings.window.x != Some(x)
                || inner.settings.window.y != Some(y);
            inner.settings.window.width = Some(width);
            inner.settings.window.height = Some(height);
            inner.settings.window.x = Some(x);
            inner.settings.window.y = Some(y);
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
