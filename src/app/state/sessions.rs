//! Chat session list mutation helpers.

use super::AppState;
use crate::app::view::AppSnapshot;
use crate::domain::ChatSession;
use crate::domain::messages::*;
use anyhow::{Result, anyhow};

impl AppState {
    /// Creates a new chat session using the selected model.
    pub fn create_session(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.ensure_selected_model();
        let session = ChatSession::with_model(inner.settings.model.clone());
        inner.settings.active_session_id = session.id.clone();
        inner.sessions.push(session);
        inner.status = STATUS_NEW_CHAT_CREATED.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Selects a chat session and loads its model settings.
    pub fn select_session(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        if !inner.sessions.iter().any(|s| s.id == session_id) {
            return Err(anyhow!(ERR_NOT_FOUND_SESSION));
        }
        inner.settings.active_session_id = session_id.to_owned();
        inner.load_active_session_model_settings()?;
        inner.status = STATUS_CHAT_SELECTED.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Deletes a chat session and creates a replacement when needed.
    pub fn delete_session(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.sessions.retain(|s| s.id != session_id);
        if inner.sessions.is_empty() {
            inner.ensure_selected_model();
            let model = inner.settings.model.clone();
            inner.sessions.push(ChatSession::with_model(model));
        }
        if !inner
            .sessions
            .iter()
            .any(|s| s.id == inner.settings.active_session_id)
        {
            inner.settings.active_session_id = inner
                .sessions
                .first()
                .map(|s| s.id.clone())
                .unwrap_or_default();
            inner.load_active_session_model_settings()?;
        }
        inner.status = STATUS_CHAT_DELETED.to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }
}
