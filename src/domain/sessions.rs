//! Chat session and message domain models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: ChatRole,
    pub text: String,
    #[serde(default)]
    pub image_data_urls: Vec<String>,
    pub created_at: DateTime<Utc>,
}

impl ChatMessage {
    /// Creates a user message with optional pasted image data URLs.
    pub fn user(text: String, image_data_urls: Vec<String>) -> Self {
        Self {
            id: new_record_id("msg"),
            role: ChatRole::User,
            text,
            image_data_urls,
            created_at: Utc::now(),
        }
    }

    /// Creates an empty assistant message used while a response streams.
    pub fn assistant_placeholder() -> Self {
        Self {
            id: new_record_id("msg"),
            role: ChatRole::Assistant,
            text: String::new(),
            image_data_urls: Vec::new(),
            created_at: Utc::now(),
        }
    }

    /// Reports whether a message has text or image content.
    pub fn has_content(&self) -> bool {
        !self.text.trim().is_empty() || !self.image_data_urls.is_empty()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String,
    #[serde(default = "default_thinking_variant")]
    pub thinking_variant: String,
    #[serde(default = "default_verbosity_setting")]
    pub verbosity: String,
    #[serde(default)]
    pub extended_thinking: bool,
    #[serde(default = "default_claude_effort")]
    pub claude_effort: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

impl ChatSession {
    /// Creates an empty local chat session.
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            id: new_record_id("session"),
            title: "New chat".to_owned(),
            model: String::new(),
            reasoning_effort: default_reasoning_effort(),
            thinking_variant: default_thinking_variant(),
            verbosity: default_verbosity_setting(),
            extended_thinking: false,
            claude_effort: default_claude_effort(),
            created_at: now,
            updated_at: now,
            messages: Vec::new(),
        }
    }

    /// Creates an empty local chat session pinned to a model id.
    pub fn with_model(model: String) -> Self {
        let mut s = Self::new();
        s.model = model;
        s
    }
}

/// Provides an empty model until providers load their model catalogs.
fn default_model() -> String {
    String::new()
}

/// Disables reasoning_effort by default.
fn default_reasoning_effort() -> String {
    "none".to_owned()
}

/// Supplies the default Codex thinking setting.
fn default_thinking_variant() -> String {
    crate::domain::DEFAULT_THINKING_VARIANT.to_owned()
}

/// Supplies the default Codex verbosity setting.
fn default_verbosity_setting() -> String {
    crate::domain::DEFAULT_VERBOSITY_SETTING.to_owned()
}

/// Supplies the default Claude effort setting.
fn default_claude_effort() -> String {
    "high".to_owned()
}

/// Creates a short local fallback title from the first user message.
pub fn fallback_session_title(message: &ChatMessage) -> String {
    let source = if message.text.trim().is_empty() {
        "Image chat"
    } else {
        message.text.trim()
    };
    let mut title = source.chars().take(42).collect::<String>();
    if source.chars().count() > 42 {
        title.push_str("...");
    }
    title
}

/// Cleans a generated session title for local display.
pub fn sanitize_session_title(value: &str) -> Option<String> {
    let cleaned = value
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(['"', '\'', '`', '*', '#', ':', '.', ' '])
        .trim()
        .chars()
        .take(42)
        .collect::<String>();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Generates a stable-enough local record id with a readable prefix.
fn new_record_id(prefix: &str) -> String {
    format!(
        "{}-{}-{:016x}",
        prefix,
        Utc::now().timestamp_millis(),
        rand::random::<u64>()
    )
}
