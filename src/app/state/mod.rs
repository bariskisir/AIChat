//! Shared application state and business logic module root.

mod auth;
mod catalog;
mod chat;
mod sessions;
mod settings;

use super::view::{AccountSnapshot, AppSnapshot, CatalogSnapshot};
use crate::domain::{
    AppSettings, CatalogStorage, ChatSession, ClaudeCredential, DEFAULT_WINDOW_HEIGHT,
    DEFAULT_WINDOW_WIDTH,
};
use crate::infra::{paths::AppPaths, shell, storage::Storage};
use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::runtime::Runtime;

#[derive(Clone)]
pub struct AppState {
    pub(super) inner: Arc<Mutex<StateInner>>,
    pub(super) runtime: Arc<Runtime>,
}

pub(super) struct StateInner {
    pub(super) storage: Storage,
    pub(super) settings: AppSettings,
    pub(super) auth: ClaudeCredential,
    pub(super) catalog: CatalogStorage,
    pub(super) status: String,
    pub(super) sessions: Vec<ChatSession>,
    pub(super) active_chat_responses: HashMap<String, chat::ActiveChatResponse>,
}

impl AppState {
    /// Loads persisted state, repairs missing session selection, and creates the runtime.
    pub fn new(paths: AppPaths) -> Result<Self> {
        let storage = Storage::new(&paths)?;
        let mut settings = storage.load_settings()?;
        let auth = storage.load_auth()?;
        let catalog = storage.load_catalog()?;
        let mut sessions = storage.load_sessions()?;
        if !settings.window_layout_initialized {
            settings.window_width = DEFAULT_WINDOW_WIDTH;
            settings.window_height = DEFAULT_WINDOW_HEIGHT;
            settings.window_layout_initialized = true;
            storage.save_settings(&settings)?;
        }
        if sessions.is_empty() {
            sessions.push(ChatSession::new());
        }
        if !sessions.iter().any(|s| s.id == settings.active_session_id) {
            settings.active_session_id = sessions.first().map(|s| s.id.clone()).unwrap_or_default();
            storage.save_settings(&settings)?;
        }
        if let Some(session) = sessions
            .iter_mut()
            .find(|s| s.id == settings.active_session_id)
        {
            settings.model = session.model.clone();
            storage.save_sessions(&sessions)?;
            storage.save_settings(&settings)?;
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(StateInner {
                storage,
                settings,
                auth,
                catalog,
                status: "Ready.".to_owned(),
                sessions,
                active_chat_responses: HashMap::new(),
            })),
            runtime: Arc::new(Runtime::new()?),
        })
    }

    /// Returns a frontend-ready snapshot of the current app state.
    pub fn snapshot(&self) -> Result<AppSnapshot> {
        let inner = self.lock()?;
        Ok(inner.build_snapshot())
    }

    /// Opens a known external link target.
    pub fn open_link(&self, target: &str) -> Result<()> {
        match target {
            "developer" => shell::open_url("https://www.bariskisir.com"),
            "source" => shell::open_url("https://github.com/bariskisir/ClaudeChat"),
            _ => Err(anyhow!("Unknown link target.")),
        }
    }

    /// Updates the current status message without failing the caller.
    pub(super) fn set_status(&self, message: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.status = message.to_owned();
        }
    }

    /// Locks shared state and maps poisoning to an application error.
    pub(super) fn lock(&self) -> Result<MutexGuard<'_, StateInner>> {
        self.inner
            .lock()
            .map_err(|_| anyhow!("App state lock failed"))
    }
}

impl StateInner {
    /// Builds the serializable state shape consumed by the frontend.
    pub(super) fn build_snapshot(&self) -> AppSnapshot {
        let active_session = self
            .sessions
            .iter()
            .find(|s| s.id == self.settings.active_session_id)
            .cloned()
            .or_else(|| self.sessions.first().cloned())
            .unwrap_or_else(ChatSession::new);
        let is_generating = self.active_chat_responses.contains_key(&active_session.id);
        AppSnapshot {
            settings: self.settings.clone(),
            status: self.status.clone(),
            account: AccountSnapshot {
                logged_in: self.auth.is_signed_in(),
                email: self.auth.email.clone(),
                plan: self.auth.plan.clone(),
                error: self.auth.error.clone(),
            },
            catalog: CatalogSnapshot {
                models: self.catalog.available_models.clone(),
            },
            sessions: self.sessions.clone(),
            active_session,
            is_generating,
        }
    }

    /// Copies model and thinking settings from the active session into global settings.
    pub(super) fn load_active_session_model_settings(&mut self) -> Result<()> {
        let session = self
            .sessions
            .iter()
            .find(|s| s.id == self.settings.active_session_id)
            .ok_or_else(|| anyhow!("Chat session not found."))?;
        self.settings.model = session.model.clone();
        self.settings.extended_thinking = session.extended_thinking;
        self.ensure_selected_model();
        self.save_active_session_model_settings()?;
        Ok(())
    }

    /// Copies global model and thinking settings back into the active session.
    pub(super) fn save_active_session_model_settings(&mut self) -> Result<()> {
        let model = self.settings.model.clone();
        let ext = self.settings.extended_thinking;
        let session = self.active_session_mut()?;
        session.model = model;
        session.extended_thinking = ext;
        Ok(())
    }

    /// Ensures the selected model is valid, preferring the first visible catalog model.
    pub(super) fn ensure_selected_model(&mut self) {
        if self
            .catalog
            .available_models
            .iter()
            .any(|m| !m.hidden && m.model == self.settings.model)
        {
            return;
        }
        if let Some(model) = self
            .catalog
            .available_models
            .iter()
            .find(|m| !m.hidden)
            .or_else(|| self.catalog.available_models.first())
            .map(|m| m.model.clone())
        {
            self.settings.model = model;
        }
    }

    /// Returns the active mutable chat session.
    pub(super) fn active_session_mut(&mut self) -> Result<&mut ChatSession> {
        let id = self.settings.active_session_id.clone();
        self.session_mut(&id)
    }

    /// Returns a mutable chat session by id.
    pub(super) fn session_mut(&mut self, id: &str) -> Result<&mut ChatSession> {
        self.sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| anyhow!("Chat session not found."))
    }
}
