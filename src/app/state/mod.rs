//! Shared application state and business logic module root.

mod antigravity;
mod chat;
mod chat_pipeline;
mod claude;
mod claudecode;
mod codex;
mod providers;
mod sessions;
mod settings;

use super::view::{
    AccountSnapshot, AntigravityAccountSnapshot, AppSnapshot, CatalogSnapshot,
    ClaudeAccountSnapshot, ClaudeCodeAccountSnapshot, CodexAccountSnapshot, ProviderSnapshot,
};
use crate::domain::messages::*;
use crate::domain::{
    AntigravityStatus, AppSettings, ChatSession, ClaudeCodeStatus, CodexStatus, ProviderStorage,
    model_key,
};
use crate::infra::{codex_credentials, paths::AppPaths, shell, storage::Storage};
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
    pub(super) antigravity: AntigravityStatus,
    pub(super) claude_code: ClaudeCodeStatus,
    pub(super) codex: CodexStatus,
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
        let antigravity = AntigravityStatus::default();
        let claude_code = ClaudeCodeStatus::default();
        let codex = CodexStatus::default();
        let mut providers = storage.load_providers()?;
        providers.ensure_builtin_providers();
        storage.save_providers(&providers)?;
        let mut sessions = storage.load_sessions()?;
        repair_session_selection(&mut sessions, &mut settings, &storage)?;
        let status = initialize_status(&providers);
        Ok(Self {
            inner: Arc::new(Mutex::new(StateInner {
                storage,
                settings,
                antigravity,
                claude_code,
                codex,
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

    /// Checks for updates and returns a version string.
    pub fn app_version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_owned()
    }

    /// Returns whether update check on startup is enabled.
    pub fn check_updates_on_startup(&self) -> bool {
        self.lock()
            .map(|inner| inner.settings.updates.check_on_startup)
            .unwrap_or(false)
    }

    /// Spawns a background task for startup update checking.
    pub fn spawn_update_check(&self, _app_handle: tauri::AppHandle) {
        let version = self.app_version();
        let _state = self.clone();
        self.runtime.spawn(async move {
            let result = crate::infra::update::check_for_update(&version).await;
            if result.has_update {
                crate::infra::update::show_update_notification(&result.latest_version);
            }
            if !result.error_message.is_empty() {
                log::warn!("Update check failed: {}", result.error_message);
            }
        });
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
        let version = env!("CARGO_PKG_VERSION").to_owned();
        let claude_provider = self.providers.providers.iter().find(|p| p.api_url.trim() == crate::domain::CLAUDE_PROVIDER_URL);
        let claude_auth = claude_provider.and_then(|p| p.claude_auth.as_ref());
        let all_models = self.providers.all_models();
        let model_id = crate::domain::active_model_id(&self.settings.model);
        let catalog_model = all_models.iter().find(|m| m.model == model_id);
        AppSnapshot {
            settings: self.settings.clone(),
            status: self.status.clone(),
            version,
            account: AccountSnapshot {
                logged_in: false,
                email: String::new(),
                error: String::new(),
            },
            claude_account: ClaudeAccountSnapshot {
                logged_in: claude_auth.map(|a| a.is_signed_in()).unwrap_or(false),
                email: claude_auth.map(|a| a.email.clone()).unwrap_or_default(),
                plan: claude_auth.map(|a| a.plan.clone()).unwrap_or_default(),
                error: claude_auth.map(|a| a.error.clone()).unwrap_or_default(),
            },
            claude_code_account: ClaudeCodeAccountSnapshot {
                available: crate::infra::claudecode::credentials_available(),
                plan: self.claude_code.plan.clone(),
                limit_label: self.claude_code.limit_label.clone(),
                error: self.claude_code.error.clone(),
            },
            antigravity_account: AntigravityAccountSnapshot {
                available: crate::infra::antigravity::credentials_available() || !self.antigravity.project_id.is_empty(),
                email: self.antigravity.email.clone(),
                project_id: self.antigravity.project_id.clone(),
                plan: self.antigravity.plan.clone(),
                cli_version: self.antigravity.cli_version.clone(),
                limit_label: self.antigravity.limit_label.clone(),
                error: self.antigravity.error.clone(),
            },
            codex_account: CodexAccountSnapshot {
                available: codex_credentials::credentials_available(),
                email: self.codex.email.clone(),
                plan: self.codex.plan.clone(),
                limit_label: self.codex.limit_label.clone(),
                error: self.codex.error.clone(),
            },
            providers: ProviderSnapshot {
                configured: !self.providers.providers.is_empty(),
                providers: self.providers.providers.clone(),
                active_provider_id: self.active_provider_id(),
                templates: crate::domain::provider_templates().to_vec(),
                codex_url: crate::domain::CODEX_PROVIDER_URL.to_owned(),
                claude_url: crate::domain::CLAUDE_PROVIDER_URL.to_owned(),
                claude_code_url: crate::domain::CLAUDE_CODE_PROVIDER_URL.to_owned(),
                antigravity_url: crate::domain::ANTIGRAVITY_PROVIDER_URL.to_owned(),
                default_model_filter_regex: crate::domain::DEFAULT_MODEL_FILTER_REGEX.to_owned(),
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
                models: all_models.clone(),
                thinking_variants: crate::domain::thinking_variants_for(&all_models, &model_id),
                verbosity_supported: catalog_model.map(|m| m.support_verbosity).unwrap_or(false),
                default_verbosity: catalog_model.map(|m| m.default_verbosity.clone()).unwrap_or_else(|| crate::domain::DEFAULT_VERBOSITY.to_owned()),
                limit_label: self.codex.limit_label.clone(),
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
        self.settings.model_settings.reasoning_effort = session.reasoning_effort.clone();
        self.settings.model_settings.thinking_variant = session.thinking_variant.clone();
        self.settings.model_settings.verbosity = session.verbosity.clone();
        self.settings.model_settings.extended_thinking = session.extended_thinking;
        self.settings.model_settings.claude_effort = session.claude_effort.clone();
        self.ensure_selected_model();
        self.save_active_session_model_settings()?;
        Ok(())
    }

    /// Copies global model and thinking settings back into the active session.
    pub(super) fn save_active_session_model_settings(&mut self) -> Result<()> {
        let model = self.settings.model.clone();
        let reasoning_effort = self.settings.model_settings.reasoning_effort.clone();
        let thinking_variant = self.settings.model_settings.thinking_variant.clone();
        let verbosity = self.settings.model_settings.verbosity.clone();
        let extended_thinking = self.settings.model_settings.extended_thinking;
        let claude_effort = self.settings.model_settings.claude_effort.clone();
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

    /// Returns the Claude Web provider's claude_auth reference if signed in.
    pub(super) fn get_claude_auth(&self) -> Option<&crate::domain::ClaudeCredential> {
        self.providers
            .providers
            .iter()
            .find(|p| p.api_url.trim() == crate::domain::CLAUDE_PROVIDER_URL)
            .and_then(|p| p.claude_auth.as_ref())
    }

    /// Returns the mutable Claude Web provider's claude_auth.
    pub(super) fn get_claude_auth_mut(&mut self) -> Option<&mut crate::domain::ClaudeCredential> {
        self.providers
            .providers
            .iter_mut()
            .find(|p| p.api_url.trim() == crate::domain::CLAUDE_PROVIDER_URL)
            .and_then(|p| p.claude_auth.as_mut())
    }

    /// Persists providers, settings, and sessions after a mutation.
    pub(super) fn persist_state(&mut self) -> Result<()> {
        self.storage.save_providers(&self.providers)?;
        self.storage.save_settings(&self.settings)?;
        self.storage.save_sessions(&self.sessions)?;
        Ok(())
    }
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
