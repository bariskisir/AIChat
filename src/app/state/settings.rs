//! Settings mutation helpers for shared application state.

use super::AppState;
use crate::app::view::{AppSnapshot, SettingsInput};
use crate::domain::{MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH};
use anyhow::Result;

impl AppState {
    /// Normalizes and persists settings received from the frontend.
    pub fn update_settings(&self, input: SettingsInput) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.settings.model = input.model;
        inner.settings.thinking_variant = input.thinking_variant;
        inner.normalize_model_settings();
        inner.settings.compact_mode = input.compact_mode;
        inner.settings.always_on_top = input.always_on_top;
        if let Some(width) = input.window_width {
            inner.settings.window_width = width.max(MIN_WINDOW_WIDTH);
        }
        if let Some(height) = input.window_height {
            inner.settings.window_height = height.max(MIN_WINDOW_HEIGHT);
        }
        if let Some(width) = input.sidebar_width {
            inner.settings.sidebar_width = width.clamp(MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        }
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Persists the native window size from Tauri resize events.
    pub fn save_window_size(&self, width: u32, height: u32) -> Result<()> {
        let mut inner = self.lock()?;
        let width = width.max(MIN_WINDOW_WIDTH);
        let height = height.max(MIN_WINDOW_HEIGHT);
        if inner.settings.window_width == width && inner.settings.window_height == height {
            return Ok(());
        }
        inner.settings.window_width = width;
        inner.settings.window_height = height;
        inner.storage.save_settings(&inner.settings)?;
        Ok(())
    }

    /// Persists the native window position from Tauri move events.
    pub fn save_window_position(&self, x: i32, y: i32) -> Result<()> {
        let mut inner = self.lock()?;
        if inner.settings.window_x == Some(x) && inner.settings.window_y == Some(y) {
            return Ok(());
        }
        inner.settings.window_x = Some(x);
        inner.settings.window_y = Some(y);
        inner.storage.save_settings(&inner.settings)?;
        Ok(())
    }

    /// Persists the always-on-top window setting.
    pub fn set_window_pinned(&self, enabled: bool) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.settings.always_on_top = enabled;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }
}
