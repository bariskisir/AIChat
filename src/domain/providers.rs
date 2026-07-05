//! Provider storage and configuration for AI Chat.

use super::messages::*;
use super::{
    AvailableModel, CLAUDE_CODE_PROVIDER_URL, CLAUDE_PROVIDER_URL, CODEX_PROVIDER_URL,
    ClaudeCredential, ProviderKind, default_thinking_variant, default_verbosity, fallback_thinking_variants,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const OPENCODE_PROVIDER_ID: &str = "opencode-zen";
pub const CODEX_PROVIDER_ID: &str = "codex";
pub const CLAUDE_PROVIDER_ID: &str = "claude";
pub const CLAUDE_CODE_PROVIDER_ID: &str = "claude-code";
pub const OPENCODE_DEFAULT_MODEL: &str = "deepseek-v4-flash-free";
pub const DEFAULT_MODEL_FILTER_REGEX: &str = "free|big-pickle";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStorage {
    pub providers: Vec<ProviderConfig>,
}

impl Default for ProviderStorage {
    /// Starts with the built-in fixed providers configured.
    fn default() -> Self {
        Self {
            providers: vec![
                opencode_provider(),
                codex_provider(),
                claude_provider(),
                claude_code_provider(),
            ],
        }
    }
}

impl ProviderStorage {
    /// Ensures built-in providers exist and stay marked as built-in.
    pub fn ensure_builtin_providers(&mut self) {
        if let Some(provider) = self.provider_mut(OPENCODE_PROVIDER_ID) {
            provider.built_in = true;
            if provider.name.trim().is_empty() {
                provider.name = PROVIDER_OPENCODE_NAME.to_owned();
            }
            if provider.api_url.trim().is_empty() {
                provider.api_url = "https://opencode.ai/zen/v1".to_owned();
            }
            normalize_opencode_provider(provider);
            ensure_opencode_default_model(provider);
        } else {
            self.providers.insert(0, opencode_provider());
        }
        ensure_special_builtin_provider(&mut self.providers, CODEX_PROVIDER_URL, codex_provider());
        ensure_special_builtin_provider(
            &mut self.providers,
            CLAUDE_PROVIDER_URL,
            claude_provider(),
        );
        ensure_special_builtin_provider(
            &mut self.providers,
            CLAUDE_CODE_PROVIDER_URL,
            claude_code_provider(),
        );
        self.ensure_env_providers();
    }

    /// Returns every visible model from every saved provider.
    pub fn all_models(&self) -> Vec<AvailableModel> {
        self.providers
            .iter()
            .filter(|provider| provider.enabled)
            .flat_map(|provider| {
                provider.models.iter().cloned().map(|mut model| {
                    model.provider_id = provider.id.clone();
                    model.provider_name = provider.name.clone();
                    if model.thinking_variants.is_empty() {
                        model.thinking_variants = fallback_thinking_variants();
                    }
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_headers: Vec<CustomHeader>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub custom_headers_enabled: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    #[serde(alias = "onlyFreeModels")]
    pub filter_models: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model_filter_regex: String,
    #[serde(default)]
    pub built_in: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_env: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub env_var: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default, serialize_with = "model_list::serialize", deserialize_with = "model_list::deserialize")]
    pub models: Vec<AvailableModel>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_auth: Option<ClaudeCredential>,
}

impl ProviderConfig {
    /// Returns the provider kind based on the API URL.
    pub fn kind(&self) -> ProviderKind {
        if self.api_url.trim() == CODEX_PROVIDER_URL {
            ProviderKind::Codex
        } else if self.api_url.trim() == CLAUDE_PROVIDER_URL {
            ProviderKind::Claude
        } else if self.api_url.trim() == CLAUDE_CODE_PROVIDER_URL {
            ProviderKind::ClaudeCode
        } else {
            ProviderKind::OpenAi
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomHeader {
    pub name: String,
    pub value: String,
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

/// Builds the built-in OpenCode provider.
fn opencode_provider() -> ProviderConfig {
    let mut provider = ProviderConfig {
        id: OPENCODE_PROVIDER_ID.to_owned(),
        name: PROVIDER_OPENCODE_NAME.to_owned(),
        api_url: "https://opencode.ai/zen/v1".to_owned(),
        api_key: "public".to_owned(),
        custom_headers: Vec::new(),
        custom_headers_enabled: false,
        filter_models: true,
        model_filter_regex: DEFAULT_MODEL_FILTER_REGEX.to_owned(),
        built_in: true,
        is_env: false,
        env_var: String::new(),
        enabled: true,
        models: Vec::new(),
        error: String::new(),
        claude_auth: None,
    };
    ensure_opencode_default_model(&mut provider);
    provider
}

/// Builds the fixed Codex provider shell; models are loaded from local auth.json.
fn codex_provider() -> ProviderConfig {
    ProviderConfig {
        id: CODEX_PROVIDER_ID.to_owned(),
        name: PROVIDER_CODEX_NAME.to_owned(),
        api_url: CODEX_PROVIDER_URL.to_owned(),
        api_key: String::new(),
        custom_headers: Vec::new(),
        custom_headers_enabled: false,
        filter_models: false,
        model_filter_regex: String::new(),
        built_in: true,
        is_env: false,
        env_var: String::new(),
        enabled: false,
        models: Vec::new(),
        error: AUTH_CODEX_CREDENTIALS_PROMPT.to_owned(),
        claude_auth: None,
    }
}

/// Builds the fixed Claude provider shell; models are loaded after Claude sign-in.
fn claude_provider() -> ProviderConfig {
    ProviderConfig {
        id: CLAUDE_PROVIDER_ID.to_owned(),
        name: PROVIDER_CLAUDE_NAME.to_owned(),
        api_url: CLAUDE_PROVIDER_URL.to_owned(),
        api_key: String::new(),
        custom_headers: Vec::new(),
        custom_headers_enabled: false,
        filter_models: false,
        model_filter_regex: String::new(),
        built_in: true,
        is_env: false,
        env_var: String::new(),
        enabled: false,
        models: Vec::new(),
        error: AUTH_SIGN_IN_CLAUDE_WEB_PROMPT.to_owned(),
        claude_auth: None,
    }
}

/// Builds the fixed Claude Code provider shell; models load from local CLI credentials.
fn claude_code_provider() -> ProviderConfig {
    ProviderConfig {
        id: CLAUDE_CODE_PROVIDER_ID.to_owned(),
        name: PROVIDER_CLAUDE_CODE_NAME.to_owned(),
        api_url: CLAUDE_CODE_PROVIDER_URL.to_owned(),
        api_key: String::new(),
        custom_headers: Vec::new(),
        custom_headers_enabled: false,
        filter_models: false,
        model_filter_regex: String::new(),
        built_in: true,
        is_env: false,
        env_var: String::new(),
        enabled: false,
        models: Vec::new(),
        error: AUTH_CLAUDE_CODE_PROMPT.to_owned(),
        claude_auth: None,
    }
}

/// Keeps one fixed special provider by API URL while preserving existing ids and models.
fn ensure_special_builtin_provider(
    providers: &mut Vec<ProviderConfig>,
    api_url: &str,
    fallback: ProviderConfig,
) {
    if let Some(index) = providers
        .iter()
        .position(|provider| provider.api_url.eq_ignore_ascii_case(api_url))
    {
        let provider = &mut providers[index];
        provider.built_in = true;
        // Fixed special providers always use the canonical name (keeps renames in sync).
        provider.name = fallback.name.clone();
        if provider.id.trim().is_empty() {
            provider.id = fallback.id.clone();
        }
        provider.api_url = fallback.api_url.clone();
        let keep_id = provider.id.clone();
        providers.retain(|provider| {
            provider.id == keep_id || !provider.api_url.eq_ignore_ascii_case(api_url)
        });
        return;
    }
    let insert_at = providers.len().min(2);
    providers.insert(insert_at, fallback);
}

/// Keeps OpenCode's session token in `api_key` and preserves user custom headers as-is.
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
    if provider.api_key.trim().eq_ignore_ascii_case("public")
        && provider.model_filter_regex.trim().is_empty()
    {
        provider.filter_models = true;
        provider.model_filter_regex = DEFAULT_MODEL_FILTER_REGEX.to_owned();
    }
    provider
        .custom_headers
        .retain(|header| !header.name.eq_ignore_ascii_case("x-opencode-session"));
}

/// Keeps existing persisted providers enabled until a refresh explicitly fails.
fn default_enabled() -> bool {
    true
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_false(v: &bool) -> bool {
    !*v
}

/// Adds the OpenCode default free model when the model list is empty.
fn ensure_opencode_default_model(provider: &mut ProviderConfig) {
    if provider.models.is_empty() {
        provider.models.push(AvailableModel {
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            model: OPENCODE_DEFAULT_MODEL.to_owned(),
            display_name: OPENCODE_DEFAULT_MODEL.to_owned(),
            description: PROVIDER_OPENCODE_DEFAULT_MODEL_DESC.to_owned(),
            hidden: false,
            is_default: true,
            input_modalities: vec!["text".to_owned()],
            default_thinking_variant: default_thinking_variant(),
            thinking_variants: Vec::new(),
            support_verbosity: false,
            default_verbosity: default_verbosity(),
            claude_thinking_type: String::new(),
        });
    }
}

impl ProviderStorage {
    /// Scans environment variables and creates/updates env-based providers.
    fn ensure_env_providers(&mut self) {
        let env_providers = discover_env_providers();
        let existing_names: Vec<String> = self
            .providers
            .iter()
            .filter(|p| !p.is_env)
            .map(|p| p.name.to_lowercase())
            .collect();
        for env_config in env_providers {
            let existing = self
                .providers
                .iter()
                .position(|p| p.is_env && p.env_var.eq_ignore_ascii_case(&env_config.env_var));
            let name = dedup_env_name(&env_config.name, &existing_names);
            if let Some(index) = existing {
                let provider = &mut self.providers[index];
                if provider.name.trim().is_empty()
                    || provider.api_url.trim().is_empty()
                {
                    provider.name = name;
                    provider.api_url = env_config.api_url.clone();
                    provider.api_key = String::new();
                }
                provider.is_env = true;
                provider.env_var = env_config.env_var;
                provider.built_in = true;
            } else {
                self.providers.push(ProviderConfig {
                    id: format!("env-{}", env_config.env_var.to_lowercase()),
                    name,
                    api_url: env_config.api_url,
                    api_key: String::new(),
                    custom_headers: Vec::new(),
                    custom_headers_enabled: false,
                    filter_models: false,
                    model_filter_regex: String::new(),
                    built_in: true,
                    is_env: true,
                    env_var: env_config.env_var,
                    enabled: true,
                    models: Vec::new(),
                    error: String::new(),
                    claude_auth: None,
                });
            }
        }
    }
}

struct EnvProviderTemplate {
    env_var: String,
    name: String,
    api_url: String,
}

/// Discovers provider templates from environment variables.
fn discover_env_providers() -> Vec<EnvProviderTemplate> {
    let templates = provider_templates();
    let mut providers = Vec::new();
    for template in templates {
        let env_var = format!("{}_API_KEY", template.name.to_uppercase().replace(|c: char| !c.is_ascii_alphanumeric(), ""));
        if let Ok(value) = std::env::var(&env_var) {
            if !value.trim().is_empty() {
                providers.push(EnvProviderTemplate {
                    env_var,
                    name: template.name.clone(),
                    api_url: template.api_url.clone(),
                });
            }
        }
    }
    providers
}

/// Adds `_env` suffix if a non-env provider with the same name already exists.
fn dedup_env_name(name: &str, existing_names: &[String]) -> String {
    if existing_names.iter().any(|n| n.eq_ignore_ascii_case(name)) {
        format!("{name}_env")
    } else {
        name.to_owned()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTemplate {
    pub name: String,
    #[serde(rename = "apiUrl")]
    pub api_url: String,
}

static TEMPLATES: LazyLock<Vec<ProviderTemplate>> = LazyLock::new(|| {
    RAW_TEMPLATES
        .iter()
        .map(|&(name, url)| ProviderTemplate {
            name: name.to_owned(),
            api_url: url.to_owned(),
        })
        .collect()
});

/// Returns all known provider templates.
pub fn provider_templates() -> &'static [ProviderTemplate] {
    &TEMPLATES
}

const RAW_TEMPLATES: &[(&str, &str)] = &[
    ("Abacus", "https://routellm.abacus.ai/v1"),
    ("AI21", "https://api.ai21.com/studio/v1"),
    ("AIHubMix", "https://aihubmix.com/v1"),
    ("AIMLAPI", "https://api.aimlapi.com/v1"),
    ("Anyscale", "https://api.endpoints.anyscale.com/v1"),
    ("ApiPie", "https://apipie.ai/v1"),
    ("Baichuan", "https://api.baichuan-ai.com/v1"),
    ("BaiduQianfan", "https://qianfan.baidubce.com/v2"),
    ("Cerebras", "https://api.cerebras.ai/v1"),
    ("Chutes", "https://llm.chutes.ai/v1"),
    ("Clarifai", "https://api.clarifai.com/v2/ext/openai/v1"),
    ("Cohere", "https://api.cohere.com/compatibility/v1"),
    ("CometAPI", "https://api.cometapi.com/v1"),
    ("Cortecs", "https://api.cortecs.ai/v1"),
    ("DashScope", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
    ("DeepInfra", "https://api.deepinfra.com/v1/openai"),
    ("DeepSeek", "https://api.deepseek.com/v1"),
    ("FastRouter", "https://go.fastrouter.ai/api/v1"),
    ("Fireworks", "https://api.fireworks.ai/inference/v1"),
    ("Friendli", "https://api.friendli.ai/serverless/v1"),
    ("GiteeAI", "https://ai.gitee.com/v1"),
    ("GitHubModels", "https://models.github.ai/inference"),
    ("GoogleGemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
    ("Groq", "https://api.groq.com/openai/v1"),
    ("Helicone", "https://oai.helicone.ai/v1"),
    ("Hyperbolic", "https://api.hyperbolic.xyz/v1"),
    ("HuggingFace", "https://router.huggingface.co/v1"),
    ("iFlytek", "https://spark-api-open.xf-yun.com/v1"),
    ("InfiniAI", "https://cloud.infini-ai.com/maas/v1"),
    ("Inception", "https://api.inceptionlabs.ai/v1"),
    ("io.net", "https://api.intelligence.io.solutions/api/v1"),
    ("Jina", "https://api.jina.ai/v1"),
    ("Lambda", "https://api.lambda.ai/v1"),
    ("LiteLLM", "http://localhost:4000/v1"),
    ("LMStudio", "http://localhost:1234/v1"),
    ("LocalAI", "http://localhost:8080/v1"),
    ("MiniMax", "https://api.minimax.chat/v1"),
    ("Mistral", "https://api.mistral.ai/v1"),
    ("Mixedbread", "https://api.mixedbread.ai/v1"),
    ("Moark", "https://moark.com/v1"),
    ("ModelBest", "https://openapi.modelbest.cn/v1"),
    ("ModelScope", "https://api-inference.modelscope.cn/v1"),
    ("Moonshot", "https://api.moonshot.ai/v1"),
    ("NanoGPT", "https://nano-gpt.com/api/v1"),
    ("Nebius", "https://api.studio.nebius.ai/v1"),
    ("NovitaAI", "https://api.novita.ai/v3/openai"),
    ("NVIDIA", "https://integrate.api.nvidia.com/v1"),
    ("OllamaLocal", "http://localhost:11434/v1"),
    ("Ollama", "https://ollama.com/v1"),
    ("OneAPI", "http://localhost:3000/v1"),
    ("OpenAI", "https://api.openai.com/v1"),
    ("OpenCode", "https://opencode.ai/zen/v1"),
    ("OpenPipe", "https://app.openpipe.ai/api/v1"),
    ("OpenRouter", "https://openrouter.ai/api/v1"),
    ("OVHcloud", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"),
    ("Parasail", "https://api.parasail.io/v1"),
    ("Perplexity", "https://api.perplexity.ai"),
    ("Poe", "https://api.poe.com/v1"),
    ("Portkey", "https://api.portkey.ai/v1"),
    ("Reka", "https://api.reka.ai/v1"),
    ("Replicate", "https://api.replicate.com/v1"),
    ("Requesty", "https://router.requesty.ai/v1"),
    ("SambaNova", "https://api.sambanova.ai/v1"),
    ("SenseNova", "https://api.sensenova.cn/compatible-mode/v1"),
    ("SGLang", "http://localhost:30000/v1"),
    ("SiliconFlow", "https://api.siliconflow.cn/v1"),
    ("StepFun", "https://api.stepfun.com/v1"),
    ("Synthetic", "https://api.synthetic.new/v1"),
    ("TabbyAPI", "http://localhost:5000/v1"),
    ("TencentLKEAP", "https://api.lkeap.cloud.tencent.com/v1"),
    ("Together", "https://api.together.xyz/v1"),
    ("Unify", "https://api.unify.ai/v0"),
    ("Upstage", "https://api.upstage.ai/v1"),
    ("VercelAIGateway", "https://ai-gateway.vercel.sh/v1"),
    ("vLLM", "http://localhost:8000/v1"),
    ("VolcengineArk", "https://ark.cn-beijing.volces.com/api/v3"),
    ("Voyage", "https://api.voyageai.com/v1"),
    ("xAI", "https://api.x.ai/v1"),
    ("Xinference", "http://localhost:9997/v1"),
    ("Yi", "https://api.lingyiwanwu.com/v1"),
    ("Zenmux", "https://zenmux.ai/api/v1"),
    ("Zhipu", "https://open.bigmodel.cn/api/paas/v4"),
];

/// Custom serde for compact model storage.
mod model_list {
    use super::AvailableModel;
    use serde::de::{SeqAccess, Visitor};
    use serde::ser::SerializeSeq;
    use serde::{Deserializer, Serializer};
    use std::fmt;

    pub fn serialize<S>(models: &[AvailableModel], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_seq(Some(models.len()))?;
        for model in models {
            if is_simple(model) {
                seq.serialize_element(&model.model)?;
            } else {
                seq.serialize_element(model)?;
            }
        }
        seq.end()
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<AvailableModel>, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ModelVisitor;
        impl<'de> Visitor<'de> for ModelVisitor {
            type Value = Vec<AvailableModel>;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a list of model IDs or model objects")
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut models = Vec::new();
                while let Some(value) = seq.next_element::<serde_json::Value>()? {
                    match value {
                        serde_json::Value::String(id) => {
                            models.push(AvailableModel {
                                model: id.clone(),
                                display_name: id,
                                provider_id: String::new(),
                                provider_name: String::new(),
                                description: String::new(),
                                hidden: false,
                                is_default: false,
                                input_modalities: vec!["text".to_owned()],
                                default_thinking_variant: crate::domain::DEFAULT_THINKING_VARIANT.to_owned(),
                                thinking_variants: Vec::new(),
                                support_verbosity: false,
                                default_verbosity: crate::domain::DEFAULT_VERBOSITY.to_owned(),
                                claude_thinking_type: String::new(),
                            });
                        }
                        _ => {
                            let model: AvailableModel = serde_json::from_value(value)
                                .map_err(serde::de::Error::custom)?;
                            models.push(model);
                        }
                    }
                }
                Ok(models)
            }
        }
        deserializer.deserialize_seq(ModelVisitor)
    }

    fn is_simple(model: &AvailableModel) -> bool {
        model.thinking_variants.is_empty()
            && model.claude_thinking_type.is_empty()
            && !model.support_verbosity
            && !model.hidden
            && !model.is_default
            && model.default_verbosity == crate::domain::DEFAULT_VERBOSITY
            && model.default_thinking_variant == crate::domain::DEFAULT_THINKING_VARIANT
            && (model.input_modalities.is_empty() || model.input_modalities == ["text"])
    }
}
