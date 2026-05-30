# AGENTS.md — AI Chat

## Project Overview

AI Chat is a Windows-first Tauri 2 desktop application that provides a chat interface for OpenAI-compatible APIs, ChatGPT (Codex), and Claude.ai. The Rust backend manages application state behind a mutex, persists data as JSON files, discovers provider models, streams chat responses via SSE, handles OAuth and browser-based authentication, and exposes typed Tauri commands. The TypeScript frontend renders the UI using global namespaces, triple-slash references, and a shared `Renderer`/`AppContext` pattern with no ES module imports.

**Version:** 1.3.0  
**Rust edition:** 2024  
**Key dependencies:** Tauri 2, tokio, reqwest, serde, uuid, chrono, rand, anyhow, thiserror  
**Frontend compiler:** `tsc` with `--outFile` concatenation, namespace merging

---

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────┐
│  Frontend (TypeScript, browser WebView)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ AppContext│  │ Renderer │  │ Split renderers  │  │
│  │ .model   │  │namespace │  │ (messages, model, │  │
│  │ .refs    │  │          │  │  session,         │  │
│  └────┬─────┘  └────┬─────┘  │  providers,       │  │
│       │             │        │  controls)        │  │
│       │  Api.invoke └────────┴───────────────────┘  │
│       ▼                                             │
│  TauriBridge.invokeCommand("command_name", {...})   │
└──────────────────┬──────────────────────────────────┘
                   │ IPC (Tauri invoke)
                   ▼
┌─────────────────────────────────────────────────────┐
│  Backend (Rust, Tauri)                              │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  app/commands/*.rs  — Tauri #[command] fns  │    │
│  │  Return CmdResult<T> = Result<T, String>    │    │
│  └──────────────────┬──────────────────────────┘    │
│                     │                               │
│  ┌──────────────────▼──────────────────────────┐    │
│  │  app/state/AppState  — Arc<Mutex<StateInner>>│   │
│  │  ┌──────────────────────────────────────┐   │    │
│  │  │  StateInner:                         │   │    │
│  │  │  - storage: Storage (JSON files)     │   │    │
│  │  │  - settings: AppSettings             │   │    │
│  │  │  - auth: AuthStorage (Codex tokens)  │   │    │
│  │  │  - claude_auth: ClaudeCredential     │   │    │
│  │  │  - catalog: CatalogStorage           │   │    │
│  │  │  - providers: ProviderStorage        │   │    │
│  │  │  - sessions: Vec<ChatSession>        │   │    │
│  │  │  - active_chat_responses: HashMap    │   │    │
│  │  │  - status: String                    │   │    │
│  │  └──────────────────────────────────────┘   │    │
│  └──────────────────┬──────────────────────────┘    │
│                     │                               │
│  ┌──────────────────▼──────────────────────────┐    │
│  │  infra/  — OS, network, storage             │    │
│  │  openai.rs, chatgpt/, claude/, clipboard,   │    │
│  │  extractor.rs, storage.rs, paths.rs, ...    │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  domain/  — Models, types, constants        │    │
│  │  messages.rs, providers.rs, catalog.rs,     │    │
│  │  sessions.rs, settings.rs, codex.rs,        │    │
│  │  claude.rs, error.rs, mod.rs                │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Request flow (chat send):**
1. User types message → `Api.sendChat(input)` → Tauri IPC → `chat_send` command
2. Command calls `AppState::send_message()` → validates, locks state, creates messages, spawns async stream task
3. Stream task calls `openai::stream_chat_response()` (or `chatgpt::` / `claude::`) with a delta callback
4. Delta callback calls `AppState::append_streamed_text()` + emits `UiEvent::AssistantDelta` to frontend
5. On completion → `finish_successful_chat_response()` → emits `UiEvent::Snapshot` with final state
6. On error → `finish_failed_assistant_placeholder()` cleanup + emits `UiEvent::Error` + snapshot

**Snapshot rendering flow:**
1. Backend emits `UiEvent::Snapshot { snapshot: AppSnapshot }` or frontend calls any command
2. `AppContext.renderSnapshot()` calls `Renderer.renderState(refs, model, snapshot)`
3. `renderState` delegates to: `populateOptions()`, `renderStatus()`, `renderSessions()`, `renderProviders()`, `renderMessages()`, `setCompactMode()`, `setSidebarWidth()`, `applyShowFooter()`, `applyShowInfoBar()`, `renderImagePreview()`, `updateButtons()`

---

## Complete File Reference

### `src/main.rs`
Tauri entry point. Sets console subsystem on Windows (`windows_subsystem = "windows"`). Registers all 18 Tauri commands via `generate_handler!`. In `setup()`: sets window title to `"AI Chat - v{version}"`, restores saved window size/position (clamping minimized sentinel via `is_minimized_window_position`), applies `always_on_top` setting, and registers `WindowEvent::Resized` / `WindowEvent::Moved` handlers to persist dimensions.

**Commands registered:**
`app_get_snapshot`, `settings_update`, `auth_start_login`, `auth_sign_out`, `claude_auth_start_login`, `claude_auth_sign_out`, `provider_save`, `provider_delete`, `catalog_refresh_models`, `provider_refresh_models`, `session_create`, `session_select`, `session_delete`, `chat_send`, `chat_stop`, `clipboard_write_text`, `window_set_pinned`, `link_open`

---

### `src/app/mod.rs`
Application layer root. Declares submodules: `commands`, `events`, `state`, `view`. Re-exports all Tauri command functions and `AppState`.

---

### `src/app/view.rs`
Frontend-facing Data Transfer Objects (DTOs). All types use `#[serde(rename_all = "camelCase")]` for JavaScript convention compatibility.

| Type | Purpose | Key fields |
|------|---------|------------|
| `AppSnapshot` | Complete app state pushed to frontend | `settings`, `status`, `account`, `claude_account`, `providers`, `catalog`, `sessions`, `active_session`, `is_generating` |
| `AccountSnapshot` | ChatGPT/Codex auth status | `logged_in`, `email`, `error` |
| `ClaudeAccountSnapshot` | Claude.ai auth status | `logged_in`, `email`, `plan`, `error` |
| `ProviderSnapshot` | Provider list + first error | `configured`, `providers`, `active_provider_id`, `error` |
| `CatalogSnapshot` | Model list + thinking/verbosity metadata | `models`, `thinking_variants`, `verbosity_supported`, `default_verbosity`, `limit_label` |
| `SettingsInput` | Frontend → backend settings payload | `model`, `compact_mode`, `reasoning_effort`, `thinking_variant`, `verbosity`, `extended_thinking`, `claude_effort`, `always_on_top`, window dimensions, `show_footer`, `show_info_bar`, `title_gen_model` |
| `SendMessageRequest` | Chat send payload | `text`, `image_data_urls` |
| `ProviderInput` | Provider editor form payload | `id`, `name`, `api_url`, `api_key`, `custom_headers` (JSON string) |

Default functions for `SettingsInput` fields (`default_thinking_variant`, `default_verbosity_setting`, `default_claude_effort`, `default_show_footer`, `default_show_info_bar`) ensure backward compatibility with older frontend builds.

---

### `src/app/events.rs`
`UiEvent` enum — all frontend-bound events flow through Tauri's `app.emit("app-event", ...)`:

| Variant | Fields | Emitted when |
|---------|--------|-------------|
| `Snapshot` | `snapshot: Box<AppSnapshot>` | Any state change; always follows `Error` events |
| `AssistantDelta` | `session_id`, `message_id`, `text` | Each streaming text chunk arrives |
| `SessionTitleUpdated` | `session_id`, `title` | Title generation completes |
| `Error` | `message` | Any error occurs; always followed by a `Snapshot` |

Frontend listens to `"app-event"` and dispatches on `payload.type`. The `#[serde(tag = "type")]` serialization produces `{"type": "snapshot", "snapshot": {...}}` etc.

---

### `src/app/commands/mod.rs`
Command module root. Defines `CmdResult<T> = std::result::Result<T, String>` — all Tauri commands return this type. `AppError` (from domain) implements `From<AppError> for String` so `?` operator works seamlessly in command functions.

Submodules: `providers` (settings, auth, provider CRUD), `sessions` (chat send/stop, session CRUD), `window` (clipboard, pin, links).

---

### `src/app/commands/providers.rs`
8 Tauri commands, all returning `CmdResult<AppSnapshot>`:

| Command | Signature | Delegate |
|---------|-----------|----------|
| `app_get_snapshot` | `() -> Snapshot` | `state.snapshot()` |
| `settings_update` | `(SettingsInput) -> Snapshot` | `state.update_settings()` |
| `auth_start_login` | `(AppHandle) -> Snapshot` | `state.start_codex_login()` |
| `auth_sign_out` | `() -> Snapshot` | `state.sign_out_codex()` |
| `claude_auth_start_login` | `(AppHandle) -> Snapshot` | `state.start_claude_login()` |
| `claude_auth_sign_out` | `() -> Snapshot` | `state.sign_out_claude()` |
| `provider_save` | `async (ProviderInput) -> Snapshot` | `state.save_provider()` |
| `provider_delete` | `(provider_id: String) -> Snapshot` | `state.delete_provider()` |
| `catalog_refresh_models` | `async () -> Snapshot` | `state.refresh_all_models()` |
| `provider_refresh_models` | `async (provider_id: String) -> Snapshot` | `state.refresh_provider_models()` |

---

### `src/app/commands/sessions.rs`
4 Tauri commands:

| Command | Signature | Delegate |
|---------|-----------|----------|
| `session_create` | `() -> Snapshot` | `state.create_session()` |
| `session_select` | `(session_id: String) -> Snapshot` | `state.select_session()` |
| `session_delete` | `(session_id: String) -> Snapshot` | `state.delete_session()` |
| `chat_send` | `(SendMessageRequest, AppHandle) -> Snapshot` | `state.send_message()` |
| `chat_stop` | `(session_id: String) -> Snapshot` | `state.stop_chat_response()` |

---

### `src/app/commands/window.rs`
3 Tauri commands:

| Command | Signature | Notes |
|---------|-----------|-------|
| `clipboard_write_text` | `(text: String, AppHandle)` | Windows: gets `hwnd` via Tauri window handle; other platforms use `arboard` directly |
| `window_set_pinned` | `(enabled: bool, State, AppHandle) -> Snapshot` | Persists setting then calls `window.set_always_on_top()` |
| `link_open` | `(target: String, State)` | Dispatches `"developer"` / `"source"` to `shell::open_url()`; uses `LINK_TARGET_*` / `LINK_URL_*` constants from `messages.rs` |

---

### `src/app/state/mod.rs`
Core application state module. Defines `AppState` and `StateInner`.

**`AppState`** — `Clone`-able handle wrapping:
- `inner: Arc<Mutex<StateInner>>` — all mutable state behind a std mutex
- `runtime: Arc<Runtime>` — tokio runtime for spawning async tasks

**`StateInner`** fields:
- `storage: Storage` — JSON file persistence handle
- `settings: AppSettings` — current global settings (model selection, window dimensions, UI flags)
- `auth: AuthStorage` — ChatGPT OAuth tokens and account info
- `claude_auth: ClaudeCredential` — Claude.ai session key, org_id, cookies
- `catalog: CatalogStorage` — Codex model catalog with thinking/verbosity metadata
- `providers: ProviderStorage` — all configured providers with their model lists
- `status: String` — status bar message shown in the UI
- `sessions: Vec<ChatSession>` — all local chat sessions
- `active_chat_responses: HashMap<String, ActiveChatResponse>` — running chat streams keyed by session ID

**`AppState` public methods:**

| Method | Returns | Purpose |
|--------|---------|---------|
| `new(paths)` | `Result<Self>` | Loads all persisted state, repairs session selection, creates tokio runtime |
| `snapshot()` | `Result<AppSnapshot>` | Returns complete frontend state via `StateInner::build_snapshot()` |
| `open_link(target)` | `Result<()>` | Opens developer/source URLs in default browser |
| `lock()` | `Result<MutexGuard<StateInner>>` | Acquires mutex lock, mapping poisoning to `ERR_VALIDATION_STATE_LOCK` |

**`StateInner` public methods:**

| Method | Purpose |
|--------|---------|
| `build_snapshot()` | Assembles complete `AppSnapshot` from all state fields |
| `load_active_session_model_settings()` | Copies model/thinking/verbosity/effort from session → global settings |
| `save_active_session_model_settings()` | Copies model/thinking/verbosity/effort from global settings → session |
| `ensure_selected_model()` | Validates current model exists; falls back to first visible model or clears |
| `active_provider_id()` | Parses provider ID from the `"provider/model"` selection key |
| `active_session_mut()` | Returns mutable reference to the active session |
| `session_mut(id)` | Returns mutable reference to any session by ID |
| `finalize_provider_state()` | **Shared tail for provider mutations**: repairs model selection, syncs session, saves providers + settings + sessions, returns snapshot |

**Private helper functions** (module-level):

| Function | Purpose |
|----------|---------|
| `initialize_window_layout(settings, storage)` | Sets default window dimensions on first launch; clears minimized sentinel positions |
| `repair_session_selection(sessions, settings, storage)` | Ensures at least one session exists, repairs dangling session selection, syncs model from session |
| `initialize_status(providers)` | Returns `"Add a provider first."` or `"Ready."` based on provider list |
| `active_model_id(model_key)` | **Moved to `domain/mod.rs`** — returns model ID portion of `"provider/model"` key |

---

### `src/app/state/chat.rs`
OpenAI-compatible chat submission and streaming lifecycle. Also exports shared helpers used by Codex and Claude chat modules.

**Types:**

| Type | Fields | Purpose |
|------|--------|---------|
| `ActiveChatResponse` | `session_id`, `assistant_message_id`, `abort_handle: AbortHandle` | Tracks a running chat stream for stop/cancel support |
| `PendingChatResponse` (private) | `session_id`, `assistant_message_id`, `ctx`, `request` | Captured work for `execute_chat_response()` |
| `PendingTitleResponse` (private) | `session_id`, `fallback_title`, `ctx`, `request` | Captured work for `execute_title_response()` |

**Public methods on `AppState`:**

| Method | Purpose |
|--------|---------|
| `send_message(input, app_handle)` | **Orchestrator**: validates → checks Codex/Claude delegation → ensures provider ready → prepares work → spawns stream + optional title stream → returns snapshot |
| `stop_chat_response(session_id)` | Aborts the active chat stream, removes empty assistant placeholder, returns snapshot |
| `append_streamed_text(session_id, msg_id, text)` | Appends delta text to the in-memory assistant message (called from stream callback) |
| `register_active_chat_response(session_id, msg_id, handle)` | Records an active chat response for later stop/cancel |
| `emit_snapshot_event(app_handle, snapshot)` | Static — emits `UiEvent::Snapshot` to frontend |
| `emit_assistant_delta_event(app_handle, sid, mid, text)` | Static — emits `UiEvent::AssistantDelta` to frontend |
| `emit_session_title_event(app_handle, session_id, title)` | Static — emits `UiEvent::SessionTitleUpdated` |
| `emit_error_snapshot(app_handle, error)` | Sets status, emits `Error` event, then emits a fresh snapshot |
| `save_generated_session_title(session_id, title)` | Stores generated title into the session if it still has messages |
| `finish_successful_chat_response(sid, mid, final_text)` | Stores complete answer, removes active bookkeeping, sets "Answer ready." status |
| `finish_failed_assistant_placeholder(sid, mid)` | Removes empty assistant message after a failed stream |

**Private methods on `AppState`:**

| Method | Purpose |
|--------|---------|
| `validate_can_send(input)` | Returns error if both text and images are empty |
| `prepare_chat_work(input, ctx, model)` | Locks state, validates no active response, builds user/assistant messages, optionally builds title work, persists, returns `(work, title_work)` |
| `execute_title_response(work)` | async — streams a one-shot chat completion for title generation, sanitizes + stores the result |
| `execute_chat_response(work, app_handle)` | async — streams the real chat completion with delta callbacks, returns final snapshot |

**Module-level helper functions:**

| Function | Purpose |
|----------|---------|
| `build_context_messages(session)` | Converts last `MESSAGE_CONTEXT_LIMIT` session messages into `Vec<OpenAiMessage>` for API |
| `title_prompt(message)` | Builds the `"Generate a concise chat title..."` prompt for title generation |
| `normalized_reasoning_effort(value)` | Returns `Some(value)` for `"low"/"medium"/"high"`, `None` for `"none"`/other |
| `resolve_title_provider(title_gen_model, providers)` | Resolves the dedicated provider+model for title generation from settings |
| `build_openai_title_work(...)` | Creates a `PendingTitleResponse` using either a dedicated title provider or the current provider |

---

### `src/app/state/chat_pipeline.rs`
Shared async task spawning for chat and title streams. Eliminates duplicated spawn-register-error-handle boilerplate across OpenAI, Codex, and Claude backends.

| Function | Purpose |
|----------|---------|
| `spawn_chat_stream(state, session_id, msg_id, app_handle, future)` | Spawns on tokio runtime. On success: emits `UiEvent::Snapshot`. On error: calls `finish_failed_assistant_placeholder()` + `emit_error_snapshot()`. Registers abort handle for stop support. |
| `spawn_title_stream(state, app_handle, future)` | Spawns on tokio runtime. On success: emits `UiEvent::SessionTitleUpdated`. On error: silent (title generation is best-effort). |

---

### `src/app/state/providers.rs`
Provider configuration and model refresh state logic.

**Types:**
- `RefreshOutcome` (private): `{ snapshot: AppSnapshot, refreshed: bool }`

**Public methods on `AppState`:**

| Method | Purpose |
|--------|---------|
| `save_provider(input)` | async — validates input, fetches models from provider, upserts provider, returns snapshot via `finalize_provider_state()` |
| `delete_provider(provider_id)` | Removes provider (rejects built-in), clears associated auth, returns snapshot via `finalize_provider_state()` |
| `refresh_all_models()` | async — iterates all providers, refreshes each, returns summary snapshot |
| `refresh_provider_models(provider_id)` | async — refreshes single provider, returns snapshot |

**`pub(super)` methods (shared within `app::state`):**

| Method | Purpose |
|--------|---------|
| `selected_provider_context()` | Returns `(OpenAiContext, model_id)` for the currently selected model |
| `selected_provider_is_codex()` | true if the active model belongs to a Codex provider |
| `selected_provider_is_claude()` | true if the active model belongs to a Claude provider |
| `ensure_provider_ready()` | Returns error if no providers or no model selected |

**Module-level helpers:**

| Function | Purpose |
|----------|---------|
| `provider_from_input(input)` | Validates and maps `ProviderInput` → `ProviderConfig` |
| `fetch_models_for_save(provider)` | async — fetches models from `/models`, rejects empty lists |
| `parse_custom_headers(value)` | Parses JSON string into `Vec<CustomHeader>` |
| `opencode_is_public(provider)` | true if OpenCode API key is exactly `"public"` |
| `filtered_opencode_models(models)` | Filters to free models only, ensures default model exists sorted first |

**Tests (3):**
- `parse_custom_headers_accepts_string_object` — valid JSON headers parse correctly
- `parse_custom_headers_rejects_non_string_values` — rejects non-string header values
- `filtered_opencode_models_keeps_free_models_with_default_first` — free model filtering logic

---

### `src/app/state/sessions.rs`
Session CRUD operations.

| Method | Purpose |
|--------|---------|
| `create_session()` | Creates new session with current model, selects it, persists |
| `select_session(session_id)` | Sets active session, loads its model settings into global settings |
| `delete_session(session_id)` | Removes session; ensures at least one session remains; repairs selection |

---

### `src/app/state/settings.rs`
Settings mutation and window state persistence.

| Method | Purpose |
|--------|---------|
| `update_settings(input)` | Applies all frontend-editable settings, normalizes thinking/verbosity/effort values, clamps window/sidebar dimensions, persists |
| `save_window_size(w, h)` | Persists current window dimensions (clamped to minimums) |
| `save_window_position(x, y)` | Persists window position (skips minimized sentinel values) |
| `set_window_pinned(enabled)` | Persists and returns always-on-top setting |

**Module-level helpers:**
- `normalize_reasoning_effort(value)` — clamps to `"low"/"medium"/"high"/"none"`
- `normalize_claude_effort(value)` — clamps to `"low"/"medium"/"high"`, defaults to `"high"`

---

### `src/app/state/codex/mod.rs`
Submodule declarations: `auth`, `chat`, `providers`.

---

### `src/app/state/codex/auth.rs`
ChatGPT OAuth sign-in flow.

| Method | Purpose |
|--------|---------|
| `start_codex_login(app_handle)` | async — opens browser for ChatGPT OAuth, runs local callback server on port 1455 |
| `sign_out_codex()` | Clears auth storage, marks Codex provider as signed out |
| `codex_access_context()` | async — returns `chatgpt::CodexAccessContext` with valid token (refreshes if expired) |

---

### `src/app/state/codex/chat.rs`
Codex ChatGPT chat submission.

**Types:** `PendingCodexChatResponse`, `PendingCodexTitleResponse`

| Method | Purpose |
|--------|---------|
| `send_codex_message(input, app_handle)` | Validates auth, prepares messages, spawns chat + optional title stream |
| `execute_codex_title_response(work)` | async — streams title generation via ChatGPT API |
| `execute_codex_chat_response(work, app_handle)` | async — streams chat response via ChatGPT API with delta callbacks |

**Module-level helpers:** `build_codex_context_messages(session)`, `codex_title_request(message, model, thinking_variant)`

---

### `src/app/state/codex/providers.rs`
Codex model refresh.

| Method | Purpose |
|--------|---------|
| `fetch_codex_models_for_provider(provider)` | async — fetches Codex model catalog + usage limits via ChatGPT account auth, updates `CatalogStorage` |

---

### `src/app/state/claude/mod.rs`
Submodule declarations: `auth`, `chat`, `providers`.

---

### `src/app/state/claude/auth.rs`
Claude.ai browser-based sign-in via Chrome DevTools Protocol.

| Method | Purpose |
|--------|---------|
| `start_claude_login(app_handle)` | Launches Chrome with `--remote-debugging-port`, waits for user to log into claude.ai, extracts session key + org ID + cookies + models via CDP |
| `sign_out_claude()` | Clears Claude credential, marks provider as signed out |
| `claude_context()` | Builds `ClaudeContext` from stored credential |

---

### `src/app/state/claude/chat.rs`
Claude.ai chat submission.

**Types:** `PendingClaudeChatResponse`, `PendingClaudeTitleResponse`

| Method | Purpose |
|--------|---------|
| `send_claude_message(input, app_handle)` | Validates auth, creates conversation UUID via `uuid::Uuid::new_v4()`, spawns chat + optional title stream |
| `execute_claude_title_response(work)` | async — creates conversation, streams title response, deletes conversation |
| `execute_claude_chat_response(work, app_handle)` | async — creates conversation, streams chat response, deletes conversation |

**Module-level helpers:**
- `build_claude_context_prompt(session)` — formats session messages as Human/Assistant conversation
- `claude_effort_for_model(value, model)` — returns `None` for Haiku models, otherwise normalized effort
- `uuid::Uuid::new_v4().to_string()` — used for conversation IDs (replaces hand-rolled `uuid_v4()`)

---

### `src/app/state/claude/providers.rs`
Claude model refresh.

| Method | Purpose |
|--------|---------|
| `fetch_claude_models_for_provider(provider)` | async — fetches Claude models via bootstrap JSON; falls back to CDP browser fetch on failure; updates account info |

---

### `src/domain/mod.rs`
Domain layer root. Re-exports all types and functions. Key items:

**Constants:**
- `SESSION_LIMIT = 100` — max persisted sessions
- `MESSAGE_CONTEXT_LIMIT = 40` — max messages sent in API context
- `CODEX_PROVIDER_URL = "codex://chatgpt"` — sentinel URL for Codex providers
- `CLAUDE_PROVIDER_URL = "claude://claude.ai"` — sentinel URL for Claude providers
- `DEFAULT_CODEX_MODEL = "gpt-5.5"` — Codex fallback model
- `DEFAULT_THINKING_VARIANT = "high"`
- `DEFAULT_VERBOSITY_SETTING = "default"`
- `DEFAULT_VERBOSITY = "medium"`
- `DEFAULT_CODEX_CLIENT_VERSION = "0.135.0"`
- `TITLE_RESPONSE_STYLE = "low"`

**Shared functions:**
- `default_reasoning_effort()`, `default_verbosity_setting()`, `default_claude_effort()` — used by `#[serde(default = "...")]` in `settings.rs` and `sessions.rs`
- `active_model_id(model_key)` — extracts model ID from `"provider_id/model_id"` string

**`ProviderKind` enum:** `OpenAi | Codex | Claude` — derived from provider API URL

---

### `src/domain/messages.rs`
**Centralized user-facing string constants.** This is the single source of truth for all user-visible text. Contains `#![allow(dead_code)]` because `FMT_*` constants cannot be used with Rust's `format!()` macro (which requires string literals). They serve as canonical documentation.

**Categories (8 sections, 64+ constants):**

| Section | Prefix | Count | Examples |
|---------|--------|-------|----------|
| Status messages | `STATUS_` | 12 | `STATUS_READY`, `STATUS_GENERATING_ANSWER`, `STATUS_ANSWER_READY`, `STATUS_NEW_CHAT_CREATED`, `STATUS_CHAT_DELETED` |
| Validation errors | `ERR_VALIDATION_` | 12 | `ERR_VALIDATION_EMPTY_MESSAGE`, `ERR_VALIDATION_STOP_FIRST`, `ERR_VALIDATION_PROVIDER_NAME_REQUIRED`, `ERR_VALIDATION_SELECT_MODEL_FIRST` |
| Not-found errors | `ERR_NOT_FOUND_` | 4 | `ERR_NOT_FOUND_PROVIDER`, `ERR_NOT_FOUND_SESSION`, `ERR_NOT_FOUND_SELECTED_PROVIDER`, `ERR_NOT_FOUND_MAIN_WINDOW` |
| Auth messages | `AUTH_` | 8 | `AUTH_SIGN_IN_CHATGPT_REQUIRED`, `AUTH_CONNECT_CLAUDE_REQUIRED`, `AUTH_SIGNED_IN_CHATGPT`, `AUTH_CONNECTED_CLAUDE` |
| Provider labels | `PROVIDER_` | 4 | `PROVIDER_OPENCODE_NAME = "OpenCode Zen"`, `PROVIDER_CODEX_NAME = "Codex"`, `PROVIDER_CLAUDE_NAME = "Claude"` |
| Chat labels | `CHAT_` | 4 | `CHAT_DEFAULT_TITLE = "New chat"`, `CHAT_IMAGE_TITLE = "Image chat"`, `CHAT_IMAGE_ATTACHED = "[Image attached]"` |
| UI labels | `LABEL_` | 5 | `LABEL_THINKING_LOW = "low"` through `LABEL_THINKING_XHIGH = "xhigh"`, `LABEL_NONE = "none"` |
| Format templates | `FMT_` | 9 | `FMT_ERROR = "Error: {}"`, `FMT_REFRESH_STATUS`, `FMT_MODELS_REFRESHED`, etc. |
| External links | `LINK_` | 4 | `LINK_TARGET_DEVELOPER`, `LINK_TARGET_SOURCE`, `LINK_URL_DEVELOPER`, `LINK_URL_SOURCE` |

**Usage pattern:**
```rust
use crate::domain::messages::*;
// In state modules — every file uses these constants
inner.status = STATUS_GENERATING_ANSWER.to_owned();
return Err(anyhow!(ERR_VALIDATION_EMPTY_MESSAGE));
```

---

### `src/domain/providers.rs`
Provider management types and built-in provider definitions (305 lines, split from `catalog.rs`).

**Types:**

| Type | Purpose |
|------|---------|
| `ProviderStorage` | Container for `Vec<ProviderConfig>` with `upsert`, `delete`, `all_models`, `provider`, `provider_mut`, `ensure_builtin_providers` |
| `ProviderConfig` | Single provider: `id`, `name`, `api_url`, `api_key`, `custom_headers: Vec<CustomHeader>`, `built_in`, `enabled`, `models: Vec<AvailableModel>`, `error` |
| `CustomHeader` | `{ name: String, value: String }` |

**Constants:**
- `OPENCODE_PROVIDER_ID = "opencode-zen"`
- `CODEX_PROVIDER_ID = "codex"`
- `CLAUDE_PROVIDER_ID = "claude"`
- `OPENCODE_DEFAULT_MODEL = "deepseek-v4-flash-free"`

**Key functions:**

| Function | Purpose |
|----------|---------|
| `model_key(provider_id, model)` | Builds `"provider_id/model_id"` selection key |
| `split_model_key(value)` | Parses `"provider_id/model_id"` → `Some((provider_id, model))` |
| `opencode_provider()` | Builds the built-in OpenCode Zen provider with `x-opencode-session` header |
| `codex_provider()` | Builds the Codex provider shell (enabled=false, models loaded after sign-in) |
| `claude_provider()` | Builds the Claude provider shell (enabled=false, models loaded after sign-in) |
| `ensure_builtin_providers()` | Repairs built-in providers on every load (creates if missing, normalizes if present) |
| `ensure_special_builtin_provider()` | Generic helper for Codex/Claude provider repair |
| `normalize_opencode_provider()` | Migrates session token from custom headers → `api_key`; keeps empty `x-opencode-session` in headers |
| `ensure_opencode_default_model()` | Injects the default free model if model list is empty |

**`ProviderConfig::kind()`** returns `ProviderKind` based on `api_url`:
- `CODEX_PROVIDER_URL` → `Codex`
- `CLAUDE_PROVIDER_URL` → `Claude`
- anything else → `OpenAi`

---

### `src/domain/catalog.rs`
Model catalog types (141 lines, slimmed from 333).

**Types:**

| Type | Purpose |
|------|---------|
| `AvailableModel` | Single model entry: `provider_id`, `provider_name`, `model`, `display_name`, `description`, `hidden`, `is_default`, `input_modalities`, `default_thinking_variant`, `thinking_variants`, `support_verbosity`, `default_verbosity` |
| `CatalogStorage` | Codex model catalog: `available_models: Vec<AvailableModel>`, `codex_client_version`, `chatgpt_limit_label`. Has methods for thinking/verbosity normalization. |
| `ThinkingVariantOption` | `{ value: String, description: String }` |

**`CatalogStorage` methods (6 public + 1 private):**

| Method | Purpose |
|--------|---------|
| `thinking_variants_for(model)` | Returns thinking options for a model with chained fallback: model → default model → first model → hardcoded fallback |
| `normalize_thinking_variant(value, model)` | Clamps thinking value to model's valid options; falls back to default |
| `normalize_verbosity(value, model)` | Keeps `"default"` sentinel; otherwise validates against recognized verbosity levels |
| `resolve_verbosity(value, model)` | Expands `"default"` sentinel to the model's default verbosity |
| `supports_verbosity(model)` | Returns whether a model supports verbosity control |
| `default_verbosity_for(model)` | Returns the model's default verbosity level |
| `find_model(model)` (private) | Finds `&AvailableModel` by model ID; extracted to eliminate 4× duplicated lookup pattern |

---

### `src/domain/codex.rs`
Codex-specific auth and defaults (117 lines, was 247).

**Types:**
- `AuthStorage` — OAuth access/refresh tokens, expiry, account info, pending OAuth state
- `PendingOAuth` — `{ state, verifier, started_at }`

**Functions:**
- `fallback_models()` — `[gpt-5.5 (default), gpt-5.4-mini]`
- `default_input_modalities()` — `["text", "image"]`
- `default_thinking_variant()` — `"high"`
- `default_support_verbosity()` — `true`
- `default_verbosity()` — `"medium"`
- `fallback_thinking_variants()` — `[low, medium, high, xhigh]` with Turkish descriptions
- `is_verbosity_level(value)` — `pub(crate)`, used by `CatalogStorage`

---

### `src/domain/claude.rs`
Claude.ai credential storage.

**`ClaudeCredential`** — `org_id`, `session_key`, `cookies: HashMap<String, String>`, `email`, `plan`, `error`
- `is_signed_in()` — true when both `org_id` and `session_key` are non-empty

---

### `src/domain/sessions.rs`
Chat session and message domain models.

**Types:**
- `ChatRole` enum: `User | Assistant`
- `ChatMessage`: `id`, `role`, `text`, `image_data_urls: Vec<String>`, `created_at`
- `ChatSession`: `id`, `title`, `model`, `reasoning_effort`, `thinking_variant`, `verbosity`, `extended_thinking`, `claude_effort`, `created_at`, `updated_at`, `messages`

**`ChatMessage` methods:**
- `user(text, image_data_urls)` — creates user message with timestamp + random ID
- `assistant_placeholder()` — creates empty assistant message for streaming
- `has_content()` — true if text non-empty or has images

**`ChatSession` methods:**
- `new()` — empty session with `"New chat"` title
- `with_model(model)` — empty session pinned to a model

**Helper functions:**
- `fallback_session_title(message)` — truncates first message to 42 chars + `"..."`
- `sanitize_session_title(value)` — cleans LLM-generated title (takes first line, strips quotes/markdown, truncates to 42 chars)
- `new_record_id(prefix)` — `"prefix-timestamp-randomhex"` format using `rand::random`

**Defaults** use `super::` paths to shared functions in `domain/mod.rs` (deduplicated from this file).

---

### `src/domain/settings.rs`
Persisted application settings.

**`AppSettings`** — 19 fields including model selection, UI flags, window dimensions, thinking/verbosity/effort settings.

**Window dimension constants:**
- `DEFAULT_WINDOW_WIDTH = 800`, `DEFAULT_WINDOW_HEIGHT = 800`
- `MIN_WINDOW_WIDTH = 700`, `MIN_WINDOW_HEIGHT = 500`
- `DEFAULT_SIDEBAR_WIDTH = 115`, `MIN_SIDEBAR_WIDTH = 80`, `MAX_SIDEBAR_WIDTH = 360`
- `MINIMIZED_WINDOW_POSITION_SENTINEL = -30000`

**`is_minimized_window_position(x, y)`** — detects Windows off-screen sentinel for minimized windows.

Defaults use `super::` paths to shared functions (deduplicated).

---

### `src/domain/error.rs`
Structured error type using `thiserror`.

**`AppError` enum:** `Validation(String)`, `Auth(String)`, `Lock`, `NotFound(String)`, `Network(String)`, `Provider(String)`. Each variant has a constructor: `AppError::validation(msg)`, etc.

**`From<AppError> for String`** — blanket conversion via `err.to_string()`, enabling `?` operator in Tauri `CmdResult<T>` return types.

---

### `src/infra/openai.rs`
OpenAI-compatible REST/SSE client (336 lines).

**Types:**
- `OpenAiContext` — request configuration: `provider_id`, `provider_name`, `api_url`, `api_key`, `custom_headers`
- `OpenAiChatRequest` — `model`, `messages: Vec<OpenAiMessage>`, `reasoning_effort: Option<String>`
- `OpenAiMessage` — `role`, `text`, `image_data_urls`

**`OpenAiContext` methods:**
- `from_provider(provider)` — builds context from `ProviderConfig`
- `is_opencode()` — true if provider_id == `"opencode-zen"`
- `is_opencode_public()` — true if OpenCode with `api_key == "public"`

**Public async functions:**
- `fetch_models(ctx)` — GET `/models`, parses `ModelsResponse`, filters free models for public OpenCode
- `stream_chat_response(ctx, request, on_delta)` — POST `/chat/completions` with SSE streaming, calls `on_delta(String)` for each delta, returns complete text

**Header builders (refactored — split):**
- `headers(ctx)` — dispatcher: calls `opencode_headers()` or `standard_headers()`
- `opencode_headers(ctx)` — sets `x-opencode-session` header from API key, skips `x-opencode-session` in custom headers
- `standard_headers(ctx)` — sets `Authorization: Bearer <key>`, processes all custom headers

**Other helpers:**
- `chat_body(request)` — builds JSON body with optional `reasoning_effort`
- `message_body(message)` — converts to text-only or multimodal (text + image_url parts)
- `parse_sse_line(line)` — parses SSE `data:` prefix, handles `[DONE]`, extracts delta text or multimodal content array
- `image_payload_rejected(body)` — heuristic detection of image-unsupported model errors
- `endpoint(ctx, path)` — joins base URL with endpoint path
- `truncate_body(value)` — limits error response bodies to 800 chars for UI display

---

### `src/infra/chatgpt/mod.rs`
Codex ChatGPT API client types. `CodexAccessContext` wraps tokens. `ChatRequest` / `ChatRequestMessage` mirror OpenAI types but with Codex-specific fields (`thinking_variant`, `response_style`, `client_version`). Also: `create_access_context(auth)`, `fetch_model_catalog(access)`, `fetch_usage_limit_label(access)`.

---

### `src/infra/chatgpt/streaming.rs`
Codex ChatGPT SSE streaming client. `stream_chat_response(access, request, on_delta)` — different wire format from OpenAI (Codex uses its own streaming protocol with different JSON structure). Also contains fallback model definitions used when the catalog is empty.

---

### `src/infra/chatgpt/oauth.rs`
ChatGPT OAuth PKCE flow. Runs a local HTTP server on `localhost:1455`, opens the browser for authorization, exchanges the code for tokens, handles token refresh. All error strings use `anyhow!()` — moving these to `messages.rs` would require format-string workarounds.

---

### `src/infra/chatgpt/catalog.rs` / `usage.rs`
Codex model catalog fetch and usage limits API calls.

---

### `src/infra/claude/mod.rs`
Claude.ai REST client. Contains:
- `ClaudeContext` — wraps `org_id`, `session_key`, `cookies`, `plan`
- `fetch_bootstrap_json(ctx)` — fetches the Claude bootstrap endpoint for models + account info
- `parse_model_response_for_plan(json, plan)` — parses bootstrap JSON into `Vec<AvailableModel>`, filtering by plan tier
- `parse_account_info(json)` — extracts `(email, plan)` from bootstrap JSON
- `create_conversation(ctx, conv_id, model)` — POST to create a conversation
- `stream_chat_response(ctx, conv_id, request, on_delta)` — SSE stream via Claude's edge API
- `delete_conversation(ctx, conv_id)` — cleanup after streaming
- `upload_image(ctx, data_url)` — converts data URL to image bytes and uploads
- Uses `uuid::Uuid::new_v4()` for conversation IDs

---

### `src/infra/claude/catalog.rs`
Claude model response parser. Extracts models from the Claude bootstrap `edge-api/bootstrap/{org_id}/app_start` JSON structure with plan-aware filtering (`opus_eligible`, `haiku_monthly_eligible`).

---

### `src/infra/extractor.rs`
Chrome DevTools Protocol integration for Claude browser login (592 lines). Key components:
- `BrowserExtractor` — launches Chrome with `--remote-debugging-port`, connects via CDP WebSocket, polls cookies until `sessionKey` appears (120 attempts, 2s timeout each), fetches organizations, extracts bootstrap JSON via JavaScript evaluation in the browser context
- `LoginResult` — `{ credential: ClaudeCredential, models: Vec<AvailableModel> }`
- `find_chrome()` — searches for Chrome/Edge/Brave in standard Windows paths + PATH
- `fetch_bootstrap_with_cookies(org_id, cookies)` — static convenience for model refresh fallback
- `Drop` impl kills Chrome process and removes temporary profile directory

---

### `src/infra/storage.rs`
JSON file persistence using `serde_json::to_string_pretty` / `from_str`. Handles BOM-stripping. Type-safe load/save pairs for all persisted types:
- `settings.json` — `AppSettings`
- `codex-auth.json` — `AuthStorage`
- `codex-catalog.json` — `CatalogStorage`
- `claude-auth.json` — `ClaudeCredential`
- `providers.json` — `ProviderStorage`
- `sessions.json` — `Vec<ChatSession>` (trimmed to `SESSION_LIMIT` on save)

---

### `src/infra/paths.rs`
`AppPaths` — resolves all JSON file paths under `dirs::data_dir()/AIChat/`. Also contains the log file path.

---

### `src/infra/clipboard.rs`
Windows: writes text via `winapi` clipboard API (`OpenClipboard`, `EmptyClipboard`, `SetClipboardData`). Other platforms: uses `arboard` crate.

---

### `src/infra/shell.rs`
Opens URLs in the default browser via `shell_execute` on Windows / `open` on macOS / `xdg-open` on Linux.

---

### `src/infra/logging.rs`
File-based logger using `simplelog`. Writes to the `app.log` path with `Info` level filtering.

---

## Frontend TypeScript Files

All frontend code uses **global namespaces** and **triple-slash references** (`/// <reference path="..." />`), *not* ES module imports. The `tsconfig.json` uses `--outFile` for concatenation and `"include": ["src/**/*"]`. Namespace merging allows split files to share the `Renderer` namespace without explicit imports.

### `frontend/src/types.d.ts`
Shared TypeScript interfaces mirroring Rust DTOs. **Must stay in sync with `src/app/view.rs` and `src/domain/`.**

All 18 interfaces — `AppSettings`, `AvailableModel`, `ThinkingVariantOption`, `ProviderConfig`, `CustomHeader`, `ProviderSnapshot`, `AccountSnapshot`, `ClaudeAccountSnapshot`, `CatalogSnapshot`, `ChatMessage`, `ChatSession` (includes `thinkingVariant` and `verbosity`), `AppSnapshot`, `FrontendSettings`, `UiEventPayload`, `SendMessageRequest`, `ProviderInput`.

Type aliases: `EffortLevel`, `EffortSetting`, `VerbosityLevel`, `VerbositySetting`, `ClaudeEffort`, `LinkTarget`, `EventType`.

### `frontend/src/constants.ts`
Frontend UI constants: status text, placeholder labels, button labels, CSS class names, keyboard key names, sidebar dimensions, event type strings, effort/verbosity levels. Mirrors some Rust domain constants but keeps frontend-specific values.

### `frontend/src/dom.ts`
DOM reference collection (147 lines, reduced from 195). Key design:
- `ELEMENT_IDS` — `as const` array of all 85 element IDs (single source of truth)
- `ElementTypeFor<K>` — conditional type infers correct HTML element type from ID suffix/prefix heuristics + 12 explicit overrides
- `Refs` — mapped type `{ [K in ElementId]: ElementTypeFor<K> }`, structurally identical to old explicit interface
- `getRefs()` — 6-line loop over `ELEMENT_IDS` instead of 85 repetitive `get("id")` lines

**To add a new DOM element:** add its ID to `ELEMENT_IDS`. If the type heuristic fails (wrong HTML element type), add an override in `ElementTypeFor`.

### `frontend/src/api.ts`
Typed Tauri command wrappers in the `Api` namespace. **All backend calls must go through here**, never raw `TauriBridge.invokeCommand("string")` outside this file. 15 methods mirroring the 18 Rust commands (some commands are combined).

### `frontend/src/app-context.ts`
`AppContext` namespace: shared state hub containing:
- `refs` — Proxy that lazily resolves `DomRefs.getRefs()`
- `model: Renderer.UiModel` — `{ appState, pendingImageDataUrls, copyResetTimer, streamAutoScroll }`
- `renderSnapshot(action)` — invokes action, renders result through `Renderer.renderState()`
- `safeInvoke(action)` — catches errors, renders them as status, returns `T | null`
- `saveSettings()` — collects settings from DOM, sends to backend, re-renders

### `frontend/src/app.ts`
Application entry point. Wires `window.__TAURI__` event listener for `"app-event"`. Dispatches on event type: `snapshot` → full re-render, `assistantDelta` → streaming update, `sessionTitleUpdated` → title refresh, `error` → error display. Also wires DOM event handlers for all buttons, keyboard shortcuts (Enter/Escape), paste handling, resize observers, dialog open/close.

### `frontend/src/render.ts`
`Renderer` namespace — the `renderState()` orchestrator. Dispatches to:
- `populateOptions(refs, state)` — model dropdown, thinking/verbosity/effort controls
- `renderStatus(refs, status)` — status bar text
- `renderSessions(refs, state)` — session sidebar list
- `renderProviders(refs, state)` — provider dialog list
- `renderMessages(refs, session, opts)` — chat message DOM with scroll management
- `setCompactMode(refs, enabled)` — compact layout toggle
- `setSidebarWidth(refs, width)` — sidebar width
- `applyShowFooter(refs, show)`, `applyShowInfoBar(refs, show)`
- `renderImagePreview(refs, model)` — pending image previews in composer
- `updateButtons(refs, model)` — button enable/disable, send/stop state

Manages `streamAutoScroll` — auto-scrolls during streaming unless user scrolls up.

**References 6 split files** (all others removed as stale): `types.d.ts`, `dom.ts`, `render-messages.ts`, `render-session.ts`, `render-providers.ts`, `render-controls.ts`.

### `frontend/src/render-messages.ts`
Renders `ChatMessage[]` as DOM. Shows copyable chat bubbles with role styling. Integrates `MarkdownRenderer.renderInto()` for assistant messages. Manages `ch-chat__empty` placeholder.

### `frontend/src/render-model.ts`
Model dropdown population, `populateModelOptions()`, model option filtering, `cssEscape()` helper.

### `frontend/src/render-session.ts`
Session sidebar rendering: title, delete button, active/inactive styling.

### `frontend/src/render-providers.ts`
Provider dialog list: shows each provider with status, enabled/disabled state, error messages.

### `frontend/src/render-controls.ts`
Status bar, button states, image preview rendering, compact mode toggle, sidebar width application, footer/infobar visibility.

### `frontend/src/markdown.ts`
Safe DOM-based Markdown renderer (`MarkdownRenderer` namespace). **Never use `innerHTML` for model output.** Supports:
- Headings (h1-h4 → h3-h6 to preserve message hierarchy)
- Code blocks (fenced with language)
- Tables (pipe tables with alignment)
- Blockquotes
- Ordered/unordered lists
- Paragraphs
- Inline: **bold**, *italic*, `code`, [links](...) (only `https:`/`mailto:` protocols)

### `frontend/src/model-dropdown.ts`
Searchable model dropdown behavior. Filters model list as user types. Keyboard navigation (Enter to select, Escape to close).

### `frontend/src/searchable-dropdown.ts`
Reusable searchable dropdown component used by model dropdown, provider template dropdown, and settings title-gen model dropdown.

### `frontend/src/provider-controls.ts`
Provider dialog form behavior: add/edit/delete provider, form validation, provider template application.

### `frontend/src/provider-templates.ts`
Built-in provider template metadata (display names, API URLs, descriptions).

### `frontend/src/provider-template-dropdown.ts`
Searchable dropdown for selecting a provider template when adding a new provider.

### `frontend/src/provider-account-panels.ts`
Codex and Claude account panel rendering: login state, email, plan, model count, usage limits, refresh/sign-out buttons.

### `frontend/src/settings-controls.ts`
Settings dialog behavior: footer toggle, infobar toggle, title generation model selection.

### `frontend/src/composer.ts`
Composer (message input) behavior: auto-resize textarea, Enter to send, Shift+Enter for newline, Escape to stop, paste image handling, send button click.

### `frontend/src/resize.ts`
Sidebar and composer resize handle drag behavior. Enforces min/max sidebar width. Writes sidebar width to backend on drag end.

### `frontend/src/clipboard.ts`
Copy-to-clipboard via Tauri backend with visual feedback (icon changes to checkmark for 1 second).

### `frontend/src/message-utils.ts`
`MessageUtils` namespace: `imageDataUrls(message)`, `hasCopyableContent(message)`, `hasCopyableMessages(session)`, `transcriptText(session)` — formats session as `User: ...\n\nAssistant: ...` transcript with image markers.

### `frontend/src/tauri-bridge.ts`
Low-level Tauri IPC wrapper. `TauriBridge.invokeCommand<T>(cmd, args?)` calls `window.__TAURI__.core.invoke()`.

### `frontend/src/tauri.d.ts`
TypeScript declarations for `window.__TAURI__` global.

---

## Build Commands

```bash
# Frontend only (TypeScript + asset copy)
cd frontend && npm.cmd run build

# Rust backend only
cargo build

# Full dev run (ensures frontend/dist exists via build.rs)
cargo run
```

Always build frontend first if `.ts` or CSS files changed. `cargo build` is enough for Rust-only changes.

---

## Coding Conventions

### Rust
- **File header:** Every `.rs` file starts with `//!` module-purpose comment.
- **Function docs:** Every `fn` has a short `///` comment above it.
- **Module boundaries:**
  - State mutations → `src/app/state/<domain>.rs`
  - Shared state + snapshot assembly → `src/app/state/mod.rs`
  - Frontend DTOs → `src/app/view.rs`
  - Tauri commands → `src/app/commands/<domain>.rs`
  - Serializable models/defaults/pure helpers → `src/domain/`
  - **All user-facing strings** → `src/domain/messages.rs` — use the constants, never hardcode
  - OS/storage/network/provider integration → `src/infra/`
- **Error handling:**
  - Internal: `anyhow::Result<T>` with `anyhow!("...")` / `.context("...")?`
  - Command boundary: convert to `String` via `CmdResult<T>`; `AppError` auto-converts via `From<AppError> for String`
  - Use `ERR_*` constants from `messages.rs` in `anyhow!()` calls
  - Use `STATUS_*` constants for `inner.status = ...`
- **String constants:** Always add new user-facing strings to `src/domain/messages.rs`. Prefix conventions:
  - Error messages → `ERR_VALIDATION_*`, `ERR_NOT_FOUND_*`
  - Status messages → `STATUS_*`
  - Auth messages → `AUTH_*`
  - Provider labels → `PROVIDER_*`
  - Chat labels → `CHAT_*`
  - Format templates → `FMT_*` (note: cannot be used in `format!()` macro, serve as canonical documentation)
  - External links → `LINK_TARGET_*`, `LINK_URL_*`
- **UUIDs:** Use `uuid::Uuid::new_v4().to_string()` from the `uuid` crate (feature `v4`). Never hand-roll with `rand`.
- **Shared helpers:** Don't duplicate functions like `active_model_id`. Use the one in `domain/mod.rs`.
- **Lock pattern:** State mutations follow `lock() → mutate → save files → build_snapshot()`. Provider mutations use `finalize_provider_state()` to consolidate the save+snapshot tail.

### TypeScript
- **File header:** Every `.ts` file starts with `/** ... */` purpose comment.
- **No ES modules:** Use global namespaces and `/// <reference path="..." />` exclusively.
- **Frontend state:** `AppContext.model` holds `Renderer.UiModel`. All state changes flow through `renderSnapshot()`.
- **API calls:** Through `Api` namespace only. No raw `TauriBridge.invokeCommand("string")` in other files.
- **Markdown:** `MarkdownRenderer.renderInto()` for all assistant messages. Never use `innerHTML` for model output.
- **DOM refs:** Add new element IDs to `ELEMENT_IDS` array in `dom.ts`. Add type overrides in `ElementTypeFor` only if the heuristic fails.
- **Image data:** Use `imageDataUrls` array field. No legacy single-image field.
- **Namespace merging:** Split render files share the `Renderer` namespace. Cross-references work without explicit imports because `tsconfig.json` includes all `src/**/*` files and they merge at runtime via `--outFile`.

### Provider Conventions
- **OpenCode Zen** is the only built-in provider with model discovery. Cannot be deleted. Defaults to `deepseek-v4-flash-free`.
- **OpenCode auth:** API key field is the `x-opencode-session` header value. Empty `x-opencode-session` entry stays in custom headers but is skipped during request building.
- **Public OpenCode:** When API key is exactly `"public"`, apply free-model filter to `/models` response.
- **Codex** and **Claude** are built-in provider shells (enabled=false) that require sign-in before use.
- **Custom headers:** Stored as structured `Vec<CustomHeader>` in Rust, edited as JSON string in the frontend.

### Persistence
- All data saved under `dirs::data_dir()/AIChat/` (typically `%APPDATA%/AIChat/` on Windows).
- JSON files: `settings.json`, `codex-auth.json`, `codex-catalog.json`, `claude-auth.json`, `providers.json`, `sessions.json`.
- Sessions trimmed to `SESSION_LIMIT` (100) on save.
- UTC timestamps via `chrono::Utc`. Domain IDs via `timestamp-randomhex` format.

---

## Verification

```bash
# TypeScript/frontend changes
cd frontend && npm.cmd run build

# Rust/backend changes
cargo build

# Both
cd frontend && npm.cmd run build && cd .. && cargo build
```

No automated test suite exists at the time of writing. The `src/app/state/providers.rs` module contains 3 unit tests for provider parsing and filtering logic.
