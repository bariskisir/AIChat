//! Shared application state and business logic module root.

mod auth;
mod catalog;
mod chat;
mod sessions;
mod settings;

use super::view::{AccountSnapshot, AppSnapshot, CatalogSnapshot};
use crate::domain::{
    AppSettings, AuthStorage, CatalogStorage, ChatSession, DEFAULT_WINDOW_HEIGHT,
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
    pub(super) auth: AuthStorage,
    pub(super) catalog: CatalogStorage,
    pub(super) status: String,
    pub(super) sessions: Vec<ChatSession>,
    pub(super) active_chat_responses: HashMap<String, chat::ActiveChatResponse>,
}

impl AppState {
    /// Initializes app state from persisted storage.
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
        if !sessions
            .iter()
            .any(|session| session.id == settings.active_session_id)
        {
            settings.active_session_id = sessions
                .first()
                .map(|session| session.id.clone())
                .unwrap_or_default();
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

    /// Returns the current frontend snapshot.
    pub fn snapshot(&self) -> Result<AppSnapshot> {
        let inner = self.lock()?;
        Ok(inner.build_snapshot())
    }

    /// Opens a known external link target in the default browser.
    pub fn open_link(&self, target: &str) -> Result<()> {
        match target {
            "developer" => shell::open_url("https://www.bariskisir.com"),
            "source" => shell::open_url("https://github.com/bariskisir/ChatGPTCodex"),
            _ => Err(anyhow!("Unknown link target.")),
        }
    }

    /// Updates the shared status message when state locking succeeds.
    pub(super) fn set_status(&self, message: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.status = message.to_owned();
        }
    }

    /// Locks the shared application state with a user-facing error on failure.
    pub(super) fn lock(&self) -> Result<MutexGuard<'_, StateInner>> {
        self.inner
            .lock()
            .map_err(|_| anyhow!("App state lock failed"))
    }
}

impl StateInner {
    /// Builds the serializable snapshot consumed by the frontend.
    pub(super) fn build_snapshot(&self) -> AppSnapshot {
        let active_session = self
            .sessions
            .iter()
            .find(|session| session.id == self.settings.active_session_id)
            .cloned()
            .or_else(|| self.sessions.first().cloned())
            .unwrap_or_else(ChatSession::new);
        let is_generating = self.active_chat_responses.contains_key(&active_session.id);
        AppSnapshot {
            settings: self.settings.clone(),
            status: self.status.clone(),
            account: AccountSnapshot {
                logged_in: self.auth.is_signed_in(),
                email: self.auth.account_email.clone(),
                error: self.auth.error.clone(),
            },
            catalog: CatalogSnapshot {
                models: self.catalog.available_models.clone(),
                thinking_variants: self.catalog.thinking_variants_for(&self.settings.model),
                limit_label: self.catalog.chatgpt_limit_label.clone(),
            },
            sessions: self.sessions.clone(),
            active_session,
            is_generating,
        }
    }

    /// Keeps model and reasoning settings valid against the current catalog.
    pub(super) fn normalize_model_settings(&mut self) {
        let model = self.catalog.normalize_model(&self.settings.model);
        let thinking_variant = self
            .catalog
            .normalize_thinking_variant(&self.settings.thinking_variant, &model);
        self.settings.model = model;
        self.settings.thinking_variant = thinking_variant;
    }

    /// Returns the active session for mutation.
    pub(super) fn active_session_mut(&mut self) -> Result<&mut ChatSession> {
        let session_id = self.settings.active_session_id.clone();
        self.session_mut(&session_id)
    }

    /// Returns the requested session for mutation.
    pub(super) fn session_mut(&mut self, session_id: &str) -> Result<&mut ChatSession> {
        self.sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or_else(|| anyhow!("Chat session was not found."))
    }
}
