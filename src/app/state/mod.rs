//! Shared application state and business logic module root.

mod chat;
mod chat_pipeline;
mod claude;
mod codex;
mod providers;
mod sessions;
mod settings;

use super::view::{
    AccountSnapshot, AppSnapshot, CatalogSnapshot, ClaudeAccountSnapshot, ProviderSnapshot,
};
use crate::domain::{
    AppSettings, AuthStorage, CatalogStorage, ChatSession, ClaudeCredential, DEFAULT_WINDOW_HEIGHT,
    DEFAULT_WINDOW_WIDTH, ProviderStorage, is_minimized_window_position, model_key,
};
use crate::domain::messages::*;
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
    pub(super) claude_auth: ClaudeCredential,
    pub(super) catalog: CatalogStorage,
    pub(super) providers: ProviderStorage,
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
        let claude_auth = storage.load_claude_auth()?;
        let catalog = storage.load_catalog()?;
        let mut providers = storage.load_providers()?;
        providers.ensure_builtin_providers();
        storage.save_providers(&providers)?;
        let mut sessions = storage.load_sessions()?;
        initialize_window_layout(&mut settings, &storage)?;
        repair_session_selection(&mut sessions, &mut settings, &storage)?;
        let status = initialize_status(&providers);
        Ok(Self {
            inner: Arc::new(Mutex::new(StateInner {
                storage,
                settings,
                auth,
                claude_auth,
                catalog,
                providers,
                status,
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
            LINK_TARGET_DEVELOPER => shell::open_url(LINK_URL_DEVELOPER),
            LINK_TARGET_SOURCE => shell::open_url(LINK_URL_SOURCE),
            _ => Err(anyhow!(ERR_VALIDATION_UNKNOWN_LINK_TARGET)),
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
            .map_err(|_| anyhow!(ERR_VALIDATION_STATE_LOCK))
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
                email: self.auth.account_email.clone(),
                error: self.auth.error.clone(),
            },
            claude_account: ClaudeAccountSnapshot {
                logged_in: self.claude_auth.is_signed_in(),
                email: self.claude_auth.email.clone(),
                plan: self.claude_auth.plan.clone(),
                error: self.claude_auth.error.clone(),
            },
            providers: ProviderSnapshot {
                configured: !self.providers.providers.is_empty(),
                providers: self.providers.providers.clone(),
                active_provider_id: self.active_provider_id(),
                error: self
                    .providers
                    .providers
                    .iter()
                    .find_map(|provider| {
                        (!provider.error.is_empty()).then(|| provider.error.clone())
                    })
                    .unwrap_or_default(),
            },
            catalog: CatalogSnapshot {
                models: self.providers.all_models(),
                thinking_variants: self
                    .catalog
                    .thinking_variants_for(&crate::domain::active_model_id(&self.settings.model)),
                verbosity_supported: self
                    .catalog
                    .supports_verbosity(&crate::domain::active_model_id(&self.settings.model)),
                default_verbosity: self
                    .catalog
                    .default_verbosity_for(&crate::domain::active_model_id(&self.settings.model)),
                limit_label: self.catalog.chatgpt_limit_label.clone(),
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
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_SESSION))?;
        self.settings.model = session.model.clone();
        self.settings.reasoning_effort = session.reasoning_effort.clone();
        self.settings.thinking_variant = session.thinking_variant.clone();
        self.settings.verbosity = session.verbosity.clone();
        self.settings.extended_thinking = session.extended_thinking;
        self.settings.claude_effort = session.claude_effort.clone();
        self.ensure_selected_model();
        self.save_active_session_model_settings()?;
        Ok(())
    }

    /// Copies global model and thinking settings back into the active session.
    pub(super) fn save_active_session_model_settings(&mut self) -> Result<()> {
        let model = self.settings.model.clone();
        let reasoning_effort = self.settings.reasoning_effort.clone();
        let thinking_variant = self.settings.thinking_variant.clone();
        let verbosity = self.settings.verbosity.clone();
        let extended_thinking = self.settings.extended_thinking;
        let claude_effort = self.settings.claude_effort.clone();
        let session = self.active_session_mut()?;
        session.model = model;
        session.reasoning_effort = reasoning_effort;
        session.thinking_variant = thinking_variant;
        session.verbosity = verbosity;
        session.extended_thinking = extended_thinking;
        session.claude_effort = claude_effort;
        Ok(())
    }

    /// Ensures the selected model is valid, preferring the first visible provider model.
    pub(super) fn ensure_selected_model(&mut self) {
        if self
            .providers
            .all_models()
            .iter()
            .any(|m| !m.hidden && model_key(&m.provider_id, &m.model) == self.settings.model)
        {
            return;
        }
        if let Some(model) = self
            .providers
            .all_models()
            .iter()
            .find(|m| !m.hidden)
            .map(|m| model_key(&m.provider_id, &m.model))
        {
            self.settings.model = model;
        } else {
            self.settings.model.clear();
        }
    }

    /// Returns the provider id from the selected model key.
    pub(super) fn active_provider_id(&self) -> String {
        crate::domain::split_model_key(&self.settings.model)
            .map(|(provider_id, _)| provider_id.to_owned())
            .unwrap_or_default()
    }

    /// Returns the active mutable chat session.
    pub(super) fn active_session_mut(&mut self) -> Result<&mut ChatSession> {
        let id = self.settings.active_session_id.clone();
        self.session_mut(&id)
    }

    /// Repairs the selected model, syncs it into the active session, and persists
    /// providers, settings, and sessions — a common tail for provider mutations.
    pub(super) fn finalize_provider_state(&mut self) -> Result<AppSnapshot> {
        self.ensure_selected_model();
        self.save_active_session_model_settings()?;
        self.storage.save_providers(&self.providers)?;
        self.storage.save_settings(&self.settings)?;
        self.storage.save_sessions(&self.sessions)?;
        Ok(self.build_snapshot())
    }

    /// Returns a mutable chat session by id.
    pub(super) fn session_mut(&mut self, id: &str) -> Result<&mut ChatSession> {
        self.sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| anyhow!(ERR_NOT_FOUND_SESSION))
    }
}

/// Sets default window dimensions on first launch and repairs minimized-position state.
fn initialize_window_layout(settings: &mut AppSettings, storage: &Storage) -> Result<()> {
    if !settings.window_layout_initialized {
        settings.window_width = DEFAULT_WINDOW_WIDTH;
        settings.window_height = DEFAULT_WINDOW_HEIGHT;
        settings.window_layout_initialized = true;
        storage.save_settings(settings)?;
    }
    if let (Some(x), Some(y)) = (settings.window_x, settings.window_y)
        && is_minimized_window_position(x, y)
    {
        settings.window_x = None;
        settings.window_y = None;
        storage.save_settings(settings)?;
    }
    Ok(())
}

/// Ensures at least one session exists and the active-session selection is valid,
/// then syncs the global model setting from the selected session.
fn repair_session_selection(
    sessions: &mut Vec<ChatSession>,
    settings: &mut AppSettings,
    storage: &Storage,
) -> Result<()> {
    if sessions.is_empty() {
        sessions.push(ChatSession::new());
    }
    if !sessions.iter().any(|s| s.id == settings.active_session_id) {
        settings.active_session_id = sessions.first().map(|s| s.id.clone()).unwrap_or_default();
        storage.save_settings(settings)?;
    }
    if let Some(session) = sessions
        .iter_mut()
        .find(|s| s.id == settings.active_session_id)
    {
        settings.model = session.model.clone();
        storage.save_sessions(sessions)?;
        storage.save_settings(settings)?;
    }
    Ok(())
}

/// Derives the initial status message from provider availability.
fn initialize_status(providers: &ProviderStorage) -> String {
    if providers.providers.is_empty() {
        STATUS_ADD_PROVIDER_FIRST.to_owned()
    } else {
        STATUS_READY.to_owned()
    }
}
