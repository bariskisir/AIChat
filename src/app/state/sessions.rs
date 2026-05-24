//! Chat session list mutation helpers.

use super::AppState;
use crate::app::view::AppSnapshot;
use crate::domain::ChatSession;
use anyhow::{Result, anyhow};

impl AppState {
    /// Creates a new chat session and selects it.
    pub fn create_session(&self) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        let session = ChatSession::new();
        inner.settings.active_session_id = session.id.clone();
        inner.sessions.push(session);
        inner.status = "New chat created.".to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Selects an existing chat session.
    pub fn select_session(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        if !inner
            .sessions
            .iter()
            .any(|session| session.id == session_id)
        {
            return Err(anyhow!("Chat session was not found."));
        }
        inner.settings.active_session_id = session_id.to_owned();
        inner.status = "Chat selected.".to_owned();
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }

    /// Deletes a chat session and keeps at least one session available.
    pub fn delete_session(&self, session_id: &str) -> Result<AppSnapshot> {
        let mut inner = self.lock()?;
        inner.sessions.retain(|session| session.id != session_id);
        if inner.sessions.is_empty() {
            inner.sessions.push(ChatSession::new());
        }
        if !inner
            .sessions
            .iter()
            .any(|session| session.id == inner.settings.active_session_id)
        {
            inner.settings.active_session_id = inner
                .sessions
                .first()
                .map(|session| session.id.clone())
                .unwrap_or_default();
        }
        inner.status = "Chat deleted.".to_owned();
        inner.storage.save_sessions(&inner.sessions)?;
        inner.storage.save_settings(&inner.settings)?;
        Ok(inner.build_snapshot())
    }
}
