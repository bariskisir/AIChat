//! Chat session and message domain models.

use super::{DEFAULT_MODEL, DEFAULT_THINKING_VARIANT, DEFAULT_VERBOSITY_SETTING};
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
    /// Builds a persisted user message from composer input.
    pub fn user(text: String, image_data_urls: Vec<String>) -> Self {
        Self {
            id: new_record_id("msg"),
            role: ChatRole::User,
            text,
            image_data_urls,
            created_at: Utc::now(),
        }
    }

    /// Builds an empty assistant placeholder for streaming.
    pub fn assistant_placeholder() -> Self {
        Self {
            id: new_record_id("msg"),
            role: ChatRole::Assistant,
            text: String::new(),
            image_data_urls: Vec::new(),
            created_at: Utc::now(),
        }
    }

    /// Returns true when the message has text or attachments.
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
    #[serde(default = "default_thinking_variant")]
    pub thinking_variant: String,
    #[serde(default = "default_verbosity")]
    pub verbosity: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

impl ChatSession {
    /// Creates a new empty chat session.
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            id: new_record_id("session"),
            title: "New chat".to_owned(),
            model: DEFAULT_MODEL.to_owned(),
            thinking_variant: DEFAULT_THINKING_VARIANT.to_owned(),
            verbosity: DEFAULT_VERBOSITY_SETTING.to_owned(),
            created_at: now,
            updated_at: now,
            messages: Vec::new(),
        }
    }

    /// Creates a new empty chat session with selected model settings.
    pub fn with_model_settings(model: String, thinking_variant: String, verbosity: String) -> Self {
        let mut session = Self::new();
        session.model = model;
        session.thinking_variant = thinking_variant;
        session.verbosity = verbosity;
        session
    }
}

/// Returns the fallback ChatGPT model identifier.
fn default_model() -> String {
    DEFAULT_MODEL.to_owned()
}

/// Returns the fallback reasoning effort value.
fn default_thinking_variant() -> String {
    DEFAULT_THINKING_VARIANT.to_owned()
}

/// Returns the fallback verbosity setting value.
fn default_verbosity() -> String {
    DEFAULT_VERBOSITY_SETTING.to_owned()
}

/// Creates a compact fallback session title from the first user message.
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

/// Cleans a generated title for sidebar display.
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

/// Creates a locally unique identifier for persisted records.
fn new_record_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{:016x}",
        Utc::now().timestamp_millis(),
        rand::random::<u64>()
    )
}
