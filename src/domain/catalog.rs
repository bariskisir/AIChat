//! Auth storage, model catalog for ClaudeChat.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Stored Claude.ai session credentials (cookies + org_id).
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCredential {
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub session_key: String,
    #[serde(default)]
    pub cookies: HashMap<String, String>,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub error: String,
}

impl ClaudeCredential {
    /// Reports whether stored credentials are enough to call Claude web APIs.
    pub fn is_signed_in(&self) -> bool {
        !self.org_id.is_empty() && !self.session_key.is_empty()
    }
}

/// Persisted model catalog loaded from Claude bootstrap data.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStorage {
    pub available_models: Vec<AvailableModel>,
}

impl Default for CatalogStorage {
    /// Starts with no models so the catalog must come from Claude.
    fn default() -> Self {
        Self {
            available_models: Vec::new(),
        }
    }
}

impl CatalogStorage {
    /// Replaces the catalog when Claude returns a non-empty model list.
    pub fn set_models(&mut self, models: Vec<AvailableModel>) {
        if !models.is_empty() {
            self.available_models = models;
        }
    }

    #[allow(dead_code)]
    /// Returns a valid model id, falling back to the first catalog entry.
    pub fn normalize_model(&self, value: &str) -> String {
        if self.available_models.iter().any(|m| m.model == value) {
            value.to_owned()
        } else {
            self.available_models
                .first()
                .map(|m| m.model.clone())
                .unwrap_or_default()
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub model: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub hidden: bool,
}
