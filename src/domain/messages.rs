//! User-facing string constants for AI Chat.
//!
//! Every constant here is a `pub const &str` with a short doc comment.
//! Use these constants instead of hardcoded strings in error messages,
//! status updates, and other user-visible output.
//!
//! Note: `FMT_` constants are format templates (contain `{}` placeholders).
//! Rust's `format!` and `anyhow!` macros require string literals as the format
//! string, so FMT_ constants cannot be passed directly to those macros. They
//! serve as documentation of the canonical format patterns used in the codebase.

#![allow(dead_code)]

// ---------------------------------------------------------------------------
// Status messages ─── STATUS_ prefix
// ---------------------------------------------------------------------------

/// Shown when no provider has been configured yet.
pub const STATUS_ADD_PROVIDER_FIRST: &str = "Add a provider first.";

/// Shown when providers are available and the app is idle.
pub const STATUS_READY: &str = "Ready.";

/// Shown while an assistant response is streaming.
pub const STATUS_GENERATING_ANSWER: &str = "Generating answer...";

/// Shown after a streaming response completes successfully.
pub const STATUS_ANSWER_READY: &str = "Answer ready.";

/// Shown after the user manually stops an in-progress response.
pub const STATUS_ANSWER_STOPPED: &str = "Answer stopped.";

/// Shown when the user tries to stop a response but none is running.
pub const STATUS_NO_ANSWER_RUNNING: &str = "No answer is running.";

/// Shown while the ChatGPT OAuth browser tab is opening.
pub const STATUS_OPENING_CHATGPT_SIGNIN: &str = "Opening ChatGPT sign-in...";

/// Shown while launching Chrome for Claude browser login.
pub const STATUS_LAUNCHING_CHROME_LOGIN: &str = "Launching Chrome for Claude login...";

/// Shown while waiting for the user to complete Claude browser login.
pub const STATUS_WAITING_CLAUDE_LOGIN: &str = "Waiting for you to log into Claude...";

/// Shown after creating a new chat session.
pub const STATUS_NEW_CHAT_CREATED: &str = "New chat created.";

/// Shown after selecting an existing chat session.
pub const STATUS_CHAT_SELECTED: &str = "Chat selected.";

/// Shown after deleting a chat session.
pub const STATUS_CHAT_DELETED: &str = "Chat deleted.";

/// Shown after a non-built-in provider is deleted.
pub const STATUS_PROVIDER_DELETED: &str = "Provider deleted.";

/// Shown after a ChatGPT-authenticated provider is deleted.
pub const STATUS_PROVIDER_DELETED_AND_SIGNED_OUT_CHATGPT: &str =
    "Provider deleted and signed out of ChatGPT.";

/// Shown after a Claude-authenticated provider is deleted.
pub const STATUS_PROVIDER_DELETED_AND_SIGNED_OUT_CLAUDE: &str =
    "Provider deleted and signed out of Claude.";

// ---------------------------------------------------------------------------
// Validation errors ─── ERR_VALIDATION_ prefix
// ---------------------------------------------------------------------------

/// Shown when the user tries to send an empty message with no image.
pub const ERR_VALIDATION_EMPTY_MESSAGE: &str = "Enter a message or paste an image first.";

/// Shown when the user tries to send while a response is already streaming.
pub const ERR_VALIDATION_STOP_FIRST: &str =
    "Stop the current answer before sending another message.";

/// Shown when the provider name field is empty on save.
pub const ERR_VALIDATION_PROVIDER_NAME_REQUIRED: &str = "Provider name is required.";

/// Shown when the API URL field is empty on save.
pub const ERR_VALIDATION_API_URL_REQUIRED: &str = "API URL is required.";

/// Shown when custom headers input is not a JSON object.
pub const ERR_VALIDATION_HEADERS_JSON_OBJECT: &str = "Custom headers must be a JSON object.";

/// Shown when a custom header value is not a string.
pub const ERR_VALIDATION_HEADER_VALUES_STRINGS: &str = "Custom header values must be strings.";

/// Shown when no model is selected before a provider-dependent action.
pub const ERR_VALIDATION_SELECT_MODEL_FIRST: &str = "Select a provider model first.";

/// Shown when the user tries to use a provider-dependent action with no providers configured.
pub const ERR_VALIDATION_ADD_PROVIDER_FIRST: &str = "Add a provider first.";

/// Shown when the user tries to delete a built-in provider.
pub const ERR_VALIDATION_BUILTIN_DELETE: &str = "Built-in providers cannot be deleted.";

/// Shown when an external link target is not recognized.
pub const ERR_VALIDATION_UNKNOWN_LINK_TARGET: &str = "Unknown link target.";

/// Shown when the shared application state mutex is poisoned.
pub const ERR_VALIDATION_STATE_LOCK: &str = "App state lock failed";

/// Shown when the selected provider was disabled due to a prior model refresh error.
pub const ERR_VALIDATION_PROVIDER_DISABLED: &str =
    "Selected provider is disabled after a model refresh error.";

// ---------------------------------------------------------------------------
// Not-found errors ─── ERR_NOT_FOUND_ prefix
// ---------------------------------------------------------------------------

/// Shown when a provider lookup by id fails.
pub const ERR_NOT_FOUND_PROVIDER: &str = "Provider not found.";

/// Shown when a chat session lookup by id fails.
pub const ERR_NOT_FOUND_SESSION: &str = "Chat session not found.";

/// Shown when the selected provider disappears from the provider list.
pub const ERR_NOT_FOUND_SELECTED_PROVIDER: &str = "Selected provider was not found.";

/// Shown when the Tauri main window handle cannot be resolved.
pub const ERR_NOT_FOUND_MAIN_WINDOW: &str = "Main window was not found.";

// ---------------------------------------------------------------------------
// Auth / sign-in messages ─── AUTH_ prefix
// ---------------------------------------------------------------------------

/// Shown when Codex chat is attempted without a ChatGPT sign-in.
pub const AUTH_SIGN_IN_CHATGPT_REQUIRED: &str = "Please sign in with ChatGPT first.";

/// Shown when Claude chat is attempted without a Claude browser login.
pub const AUTH_CONNECT_CLAUDE_REQUIRED: &str = "Connect to Claude first.";

/// Shown as the provider-level prompt to sign into ChatGPT.
pub const AUTH_SIGN_IN_CHATGPT_PROMPT: &str = "Sign in with ChatGPT.";

/// Shown as the provider-level prompt to sign into Claude.
pub const AUTH_SIGN_IN_CLAUDE_PROMPT: &str = "Sign in with Claude.";

/// Shown when the Claude API fails to create a new conversation.
pub const AUTH_FAILED_CREATE_CLAUDE_CONVERSATION: &str = "Failed to create Claude conversation.";

/// Shown as status and provider error after signing out of ChatGPT.
pub const AUTH_SIGNED_OUT_CHATGPT: &str = "Signed out of ChatGPT.";

/// Shown as status and provider error after signing out of Claude.
pub const AUTH_SIGNED_OUT_CLAUDE: &str = "Signed out of Claude.";

/// Shown after a successful ChatGPT sign-in completes.
pub const AUTH_SIGNED_IN_CHATGPT: &str = "Signed in with ChatGPT.";

/// Shown after a successful Claude browser login completes.
pub const AUTH_CONNECTED_CLAUDE: &str = "Connected to Claude.";

// ---------------------------------------------------------------------------
// Provider messages ─── PROVIDER_ prefix
// ---------------------------------------------------------------------------

/// Display name for the built-in OpenCode Zen provider.
pub const PROVIDER_OPENCODE_NAME: &str = "OpenCode Zen";

/// Display name for the built-in Codex / ChatGPT provider.
pub const PROVIDER_CODEX_NAME: &str = "Codex";

/// Display name for the built-in Claude provider.
pub const PROVIDER_CLAUDE_NAME: &str = "Claude";

/// Description for the default free model on the OpenCode Zen provider.
pub const PROVIDER_OPENCODE_DEFAULT_MODEL_DESC: &str = "OpenCode Zen default free model";

// ---------------------------------------------------------------------------
// Chat / generation messages ─── CHAT_ prefix
// ---------------------------------------------------------------------------

/// Default session title for a brand-new chat.
pub const CHAT_DEFAULT_TITLE: &str = "New chat";

/// Fallback session title when the first message contains only an image.
pub const CHAT_IMAGE_TITLE: &str = "Image chat";

/// Placeholder text for an image-only first message in a title-generation prompt.
pub const CHAT_IMAGE_ONLY_MESSAGE: &str = "Image-only first message.";

/// Image-attachment placeholder inserted into Claude conversation prompts.
pub const CHAT_IMAGE_ATTACHED: &str = "[Image attached]";

// ---------------------------------------------------------------------------
// UI labels ─── LABEL_ prefix
// ---------------------------------------------------------------------------

/// Label for the "low" thinking / reasoning effort option.
pub const LABEL_THINKING_LOW: &str = "low";

/// Label for the "medium" thinking / reasoning effort option.
pub const LABEL_THINKING_MEDIUM: &str = "medium";

/// Label for the "high" thinking / reasoning effort option.
pub const LABEL_THINKING_HIGH: &str = "high";

/// Label for the "max" Claude effort option.
pub const LABEL_THINKING_MAX: &str = "max";

/// Label for the "xhigh" thinking variant shown in Codex providers.
pub const LABEL_THINKING_XHIGH: &str = "xhigh";

/// Label for the "none" reasoning-effort / disabled value.
pub const LABEL_NONE: &str = "none";

/// Label for the current title-generation model sentinel.
pub const LABEL_CURRENT: &str = "current";

/// Default Claude effort setting.
pub const CLAUDE_EFFORT_DEFAULT: &str = LABEL_THINKING_MAX;

/// Description for low reasoning / thinking depth.
pub const DESC_THINKING_LOW: &str = "Fast responses with lighter reasoning";

/// Description for medium reasoning / thinking depth.
pub const DESC_THINKING_MEDIUM: &str = "Balanced reasoning for everyday tasks";

/// Description for high reasoning / thinking depth.
pub const DESC_THINKING_HIGH: &str = "Greater reasoning depth for complex tasks";

/// Description for extra-high Codex thinking depth.
pub const DESC_THINKING_XHIGH: &str = "Extra high reasoning depth for complex tasks";

// ---------------------------------------------------------------------------
// Format templates ─── FMT_ prefix
// ---------------------------------------------------------------------------

/// Error prefix template: `"Error: <message>"`.
pub const FMT_ERROR: &str = "Error: {}";

/// Provider-level error template: `"Provider error: <message>"`.
pub const FMT_PROVIDER_ERROR: &str = "Provider error: {}";

/// ChatGPT sign-in failure status template: `"ChatGPT sign-in failed: <message>"`.
pub const FMT_CHATGPT_SIGNIN_FAILED: &str = "ChatGPT sign-in failed: {}";

/// Claude sign-in failure status template: `"Claude sign-in failed: <message>"`.
pub const FMT_CLAUDE_SIGNIN_FAILED: &str = "Claude sign-in failed: {}";

/// Provider save confirmation template: `"<name> checked and saved."`.
pub const FMT_PROVIDER_CHECKED_SAVED: &str = "{} checked and saved.";

/// Model refresh start template: `"Refreshing <name> models..."`.
pub const FMT_REFRESHING_MODELS: &str = "Refreshing {} models...";

/// Model refresh success template: `"<name> models refreshed."`.
pub const FMT_MODELS_REFRESHED: &str = "{} models refreshed.";

/// Refresh summary template: `"<N> provider model(s) updated, <M> provider error(s)."`.
pub const FMT_REFRESH_STATUS: &str = "{} provider model(s) updated, {} provider error(s).";

/// Empty model list rejection template: `"<name> /models returned an empty model list; provider was not saved."`.
pub const FMT_EMPTY_MODEL_LIST: &str =
    "{} /models returned an empty model list; provider was not saved.";

// ---------------------------------------------------------------------------
// External links ─── LINK_ prefix
// ---------------------------------------------------------------------------

/// Link target key for the developer website.
pub const LINK_TARGET_DEVELOPER: &str = "developer";

/// Link target key for the source repository.
pub const LINK_TARGET_SOURCE: &str = "source";

/// Developer website URL.
pub const LINK_URL_DEVELOPER: &str = "https://www.bariskisir.com";

/// Source repository URL.
pub const LINK_URL_SOURCE: &str = "https://github.com/bariskisir/AIChat";
