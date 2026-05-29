//! Provider storage and model catalog for AI Chat.

use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const OPENCODE_PROVIDER_ID: &str = "opencode-zen";
pub const OPENCODE_DEFAULT_MODEL: &str = "deepseek-v4-flash-free";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStorage {
    pub providers: Vec<ProviderConfig>,
}

impl Default for ProviderStorage {
    /// Starts with the built-in OpenCode Zen provider configured.
    fn default() -> Self {
        Self {
            providers: vec![opencode_provider()],
        }
    }
}

impl ProviderStorage {
    /// Ensures built-in providers exist and stay marked as built-in.
    pub fn ensure_builtin_providers(&mut self) {
        if let Some(provider) = self.provider_mut(OPENCODE_PROVIDER_ID) {
            provider.built_in = true;
            if provider.name.trim().is_empty() {
                provider.name = "OpenCode Zen".to_owned();
            }
            if provider.api_url.trim().is_empty() {
                provider.api_url = "https://opencode.ai/zen/v1".to_owned();
            }
            normalize_opencode_provider(provider);
            ensure_opencode_default_model(provider);
        } else {
            self.providers.insert(0, opencode_provider());
        }
    }

    /// Returns every visible model from every saved provider.
    pub fn all_models(&self) -> Vec<AvailableModel> {
        self.providers
            .iter()
            .flat_map(|provider| {
                provider.models.iter().cloned().map(|mut model| {
                    model.provider_id = provider.id.clone();
                    model.provider_name = provider.name.clone();
                    model
                })
            })
            .collect()
    }

    /// Finds a provider by id.
    pub fn provider(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|provider| provider.id == id)
    }

    /// Finds a mutable provider by id.
    pub fn provider_mut(&mut self, id: &str) -> Option<&mut ProviderConfig> {
        self.providers.iter_mut().find(|provider| provider.id == id)
    }

    /// Inserts a new provider or updates an existing provider.
    pub fn upsert(&mut self, mut provider: ProviderConfig) -> String {
        if provider.id.trim().is_empty() {
            provider.id = new_provider_id();
        }
        if provider.id == OPENCODE_PROVIDER_ID {
            provider.built_in = true;
            normalize_opencode_provider(&mut provider);
            ensure_opencode_default_model(&mut provider);
        }
        let id = provider.id.clone();
        if let Some(existing) = self.provider_mut(&id) {
            if existing.built_in {
                provider.built_in = true;
            }
            provider.models = if provider.models.is_empty() {
                existing.models.clone()
            } else {
                provider.models
            };
            *existing = provider;
        } else {
            self.providers.push(provider);
        }
        id
    }

    /// Deletes a provider by id and returns whether it existed.
    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.providers.len();
        self.providers
            .retain(|provider| provider.id != id || provider.built_in);
        self.providers.len() != before
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub custom_headers: Vec<CustomHeader>,
    #[serde(default)]
    pub built_in: bool,
    #[serde(default)]
    pub models: Vec<AvailableModel>,
    #[serde(default)]
    pub error: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub provider_name: String,
    pub model: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub hidden: bool,
}

/// Builds the persisted model selection key for a provider/model pair.
pub fn model_key(provider_id: &str, model: &str) -> String {
    format!("{provider_id}/{model}")
}

/// Splits a persisted model selection key into provider id and model id.
pub fn split_model_key(value: &str) -> Option<(&str, &str)> {
    value.split_once('/')
}

/// Creates a stable local provider id.
fn new_provider_id() -> String {
    format!(
        "provider-{}-{:016x}",
        Utc::now().timestamp_millis(),
        rand::random::<u64>()
    )
}

/// Builds the built-in OpenCode Zen provider.
fn opencode_provider() -> ProviderConfig {
    let mut provider = ProviderConfig {
        id: OPENCODE_PROVIDER_ID.to_owned(),
        name: "OpenCode Zen".to_owned(),
        api_url: "https://opencode.ai/zen/v1".to_owned(),
        api_key: "public".to_owned(),
        custom_headers: vec![CustomHeader {
            name: "x-opencode-session".to_owned(),
            value: String::new(),
        }],
        built_in: true,
        models: Vec::new(),
        error: String::new(),
    };
    ensure_opencode_default_model(&mut provider);
    provider
}

/// Keeps OpenCode's session token in `api_key` while leaving its header value blank in custom headers.
fn normalize_opencode_provider(provider: &mut ProviderConfig) {
    let migrated_session = provider
        .custom_headers
        .iter()
        .find(|header| {
            header.name.eq_ignore_ascii_case("x-opencode-session")
                && !header.value.trim().is_empty()
        })
        .map(|header| header.value.trim().to_owned());
    if provider.api_key.trim().is_empty() {
        provider.api_key = migrated_session.unwrap_or_else(|| "public".to_owned());
    }
    provider
        .custom_headers
        .retain(|header| !header.name.eq_ignore_ascii_case("x-opencode-session"));
    provider.custom_headers.insert(
        0,
        CustomHeader {
            name: "x-opencode-session".to_owned(),
            value: String::new(),
        },
    );
}

/// Adds the OpenCode default free model when the model list is empty.
fn ensure_opencode_default_model(provider: &mut ProviderConfig) {
    if provider.models.is_empty() {
        provider.models.push(AvailableModel {
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            model: OPENCODE_DEFAULT_MODEL.to_owned(),
            display_name: OPENCODE_DEFAULT_MODEL.to_owned(),
            description: "OpenCode Zen default free model".to_owned(),
            hidden: false,
        });
    }
}
