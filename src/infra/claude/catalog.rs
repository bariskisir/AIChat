//! Claude bootstrap account and model catalog parsing helpers.

use crate::domain::{
    AvailableModel, ThinkingVariantOption, DEFAULT_THINKING_VARIANT, DEFAULT_VERBOSITY,
    fallback_thinking_variants, default_input_modalities,
};
use anyhow::{Result, anyhow};
use serde_json::Value;
use std::collections::HashSet;

pub(crate) fn parse_account_info(json_str: &str) -> (String, String) {
    let Ok(value) = serde_json::from_str::<Value>(json_str) else {
        return (String::new(), String::new());
    };
    let email = value
        .pointer("/account/email_address")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/account/email").and_then(Value::as_str))
        .unwrap_or("")
        .to_owned();
    let tier = current_tier(&value, None).unwrap_or_default();
    let plan = display_plan(&tier);
    (email, plan)
}

/// Parses visible Claude models for the current account tier from bootstrap JSON.
pub(crate) fn parse_model_response_for_plan(
    json_str: &str,
    plan: Option<&str>,
) -> Result<Vec<AvailableModel>> {
    let val: Value = serde_json::from_str(json_str)
        .map_err(|e| anyhow!("Could not parse model catalog response: {e}"))?;

    let stored_plan = plan.map(normalize_plan).filter(|p| !p.is_empty());
    let tier = current_tier(&val, stored_plan.as_deref());
    let tier_allowed_models = tier
        .as_deref()
        .map(|tier| collect_tier_allowed_models(&val, tier))
        .filter(|models| !models.is_empty());
    let mut models = Vec::new();
    collect_model_selector_models(&val, &mut models);
    if models.is_empty() {
        collect_bootstrap_models(&val, &mut models);
    }
    if models.is_empty() {
        let mut candidates = Vec::new();
        collect_model_candidates(&val, "", tier.as_deref(), &mut candidates);
        candidates.sort_by(|left, right| right.score.cmp(&left.score));
        models = candidates
            .into_iter()
            .filter(|candidate| candidate.available)
            .map(|candidate| candidate.model)
            .collect::<Vec<_>>();
    }
    apply_tier_allowlist(&mut models, tier_allowed_models.as_ref());
    dedupe_models(&mut models);

    if models.is_empty() {
        return Err(anyhow!("No models found in model catalog response"));
    }
    Ok(models)
}

/// Resolves the account tier from bootstrap data or an explicit plan override.
fn current_tier(value: &Value, plan: Option<&str>) -> Option<String> {
    if let Some(tier) = tier_from_capabilities(value) {
        return Some(tier);
    }
    if let Some(plan) = plan {
        return Some(tier_name(plan));
    }
    for path in [
        "/account/memberships/0/organization/rate_limit_tier",
        "/account/memberships/0/organization/billing_type",
        "/account/settings/internal_tier_rate_limit_tier",
        "/account/settings/internal_tier_seat_tier",
    ] {
        if let Some(value) = value.pointer(path).and_then(Value::as_str) {
            let tier = tier_name(value);
            if !tier.is_empty() {
                return Some(tier);
            }
        }
    }
    None
}

/// Extracts the account tier from organization capabilities (e.g. "claude_pro", "claude_max").
fn tier_from_capabilities(value: &Value) -> Option<String> {
    let caps = value
        .pointer("/account/memberships/0/organization/capabilities")?
        .as_array()?;
    for cap in caps {
        let cap = cap.as_str()?;
        if cap.starts_with("claude_") {
            let tier = tier_name(cap);
            if tier != "free" {
                return Some(tier);
            }
        }
    }
    None
}

/// Collects model identifiers allowed for a subscription tier.
fn collect_tier_allowed_models(value: &Value, tier: &str) -> HashSet<String> {
    let mut models = HashSet::new();
    collect_tier_allowed_models_at(value, tier_rank(tier), &mut models);
    models
}

/// Recursively finds Growthbook tier/model allowlist arrays.
fn collect_tier_allowed_models_at(value: &Value, current_rank: i32, models: &mut HashSet<String>) {
    match value {
        Value::Array(items) => {
            if items
                .iter()
                .any(|item| item.get("minimum_tier").is_some() && item.get("model_id").is_some())
            {
                for item in items {
                    let Some(model_id) = item.get("model_id").and_then(Value::as_str) else {
                        continue;
                    };
                    let minimum_tier = item
                        .get("minimum_tier")
                        .and_then(Value::as_str)
                        .map(tier_name)
                        .unwrap_or_else(|| "free".to_owned());
                    if tier_rank(&minimum_tier) <= current_rank {
                        models.insert(model_id.to_owned());
                    }
                }
            }
            for item in items {
                collect_tier_allowed_models_at(item, current_rank, models);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_tier_allowed_models_at(item, current_rank, models);
            }
        }
        _ => {}
    }
}

/// Marks catalog models hidden when they are not allowed for the current tier.
fn apply_tier_allowlist(models: &mut [AvailableModel], allowed: Option<&HashSet<String>>) {
    let Some(allowed) = allowed else { return };
    for model in models {
        if !allowed.contains(&model.model) {
            model.hidden = true;
        }
    }
}

/// Extracts the primary chat model selector entries from bootstrap JSON.
fn collect_model_selector_models(value: &Value, models: &mut Vec<AvailableModel>) {
    let Some(configs) = value.get("model_selector_config").and_then(Value::as_array) else {
        return;
    };
    let Some(chat_config) = configs
        .iter()
        .find(|config| config.get("id").and_then(Value::as_str) == Some("chat"))
    else {
        return;
    };
    let Some(items) = chat_config.get("models").and_then(Value::as_array) else {
        return;
    };

    for item in items {
        if let Some(model) = parse_selector_model(item) {
            models.push(model);
        }
    }
}

/// Converts one model selector entry into the app's catalog model type.
fn parse_selector_model(value: &Value) -> Option<AvailableModel> {
    let model = string_field(value, &["id", "model"])?;
    if !model.starts_with("claude-") {
        return None;
    }
    let section = value
        .get("section")
        .and_then(Value::as_str)
        .unwrap_or("main");
    let (think_type, think_variants, default_think) = parse_claude_thinking(value);
    Some(claude_available_model(
        model,
        string_field(value, &["name", "display_name", "displayName"])
            .unwrap_or_else(|| model_display_fallback(value)),
        string_field(value, &["description", "summary", "subtitle"]).unwrap_or_default(),
        section == "deprecated",
        think_type.as_deref(),
        think_variants,
        default_think,
    ))
}

/// Extracts organization bootstrap model entries when selector config is absent.
fn collect_bootstrap_models(value: &Value, models: &mut Vec<AvailableModel>) {
    let Some(memberships) = value
        .pointer("/account/memberships")
        .and_then(Value::as_array)
    else {
        return;
    };
    for membership in memberships {
        let Some(items) = membership
            .pointer("/organization/claude_ai_bootstrap_models_config")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for item in items {
            if let Some(model) = parse_bootstrap_model(item) {
                models.push(model);
            }
        }
    }
}

/// Converts one organization bootstrap model entry into a catalog model.
fn parse_bootstrap_model(value: &Value) -> Option<AvailableModel> {
    let model = string_field(value, &["model", "id"])?;
    if !model.starts_with("claude-") {
        return None;
    }
    let inactive = bool_field(value, &["inactive"]) == Some(true);
    let (think_type, think_variants, default_think) = parse_claude_thinking(value);
    Some(claude_available_model(
        model,
        string_field(value, &["name", "display_name", "displayName"])
            .unwrap_or_else(|| model_display_fallback(value)),
        string_field(value, &["description", "summary", "subtitle"]).unwrap_or_default(),
        inactive,
        think_type.as_deref(),
        think_variants,
        default_think,
    ))
}

/// Falls back to a readable model label when Claude omits display text.
fn model_display_fallback(value: &Value) -> String {
    string_field(value, &["model", "id"]).unwrap_or_else(|| "Claude".to_owned())
}

struct ModelCandidate {
    model: AvailableModel,
    available: bool,
    score: i32,
}

/// Recursively collects model-like objects when Claude changes bootstrap shape.
fn collect_model_candidates(
    value: &Value,
    path: &str,
    plan: Option<&str>,
    candidates: &mut Vec<ModelCandidate>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                if let Some(candidate) = parse_model_item(item, path, plan) {
                    candidates.push(candidate);
                }
            }
            for (index, item) in items.iter().enumerate() {
                collect_model_candidates(item, &format!("{path}[{index}]"), plan, candidates);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                if key.starts_with("claude-") {
                    if let Some(mut candidate) = parse_model_item(item, &child_path, plan) {
                        let mut model = candidate.model;
                        if model.model.is_empty() {
                            model.model = key.clone();
                        }
                        candidate.model = model;
                        candidates.push(candidate);
                    } else {
                        candidates.push(ModelCandidate {
                            model: claude_available_model(
                                key.clone(),
                                key.clone(),
                                String::new(),
                                false,
                                None,
                                None,
                                None,
                            ),
                            available: true,
                            score: model_path_score(&child_path),
                        });
                    }
                } else if let Some(candidate) = parse_model_item(item, &child_path, plan) {
                    candidates.push(candidate);
                }
                collect_model_candidates(item, &child_path, plan, candidates);
            }
        }
        _ => {}
    }
}

/// Converts an arbitrary JSON object into a model candidate when it looks like one.
fn parse_model_item(value: &Value, path: &str, plan: Option<&str>) -> Option<ModelCandidate> {
    let object = value.as_object()?;
    let model = string_field(value, &["model", "id", "name", "value"])?;
    if !model.starts_with("claude-") {
        return None;
    }
    let display_name = string_field(
        value,
        &["display_name", "displayName", "name", "title", "label"],
    )
    .unwrap_or_else(|| model.clone());
    let description =
        string_field(value, &["description", "summary", "subtitle"]).unwrap_or_default();
    let hidden = object
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let (think_type, think_variants, default_think) = parse_claude_thinking(value);
    Some(ModelCandidate {
        available: model_is_available(value, plan),
        score: model_path_score(path) + availability_score(value),
        model: claude_available_model(model, display_name, description, hidden, think_type.as_deref(), think_variants, default_think),
    })
}

/// Extracts the Claude thinking configuration from a bootstrap model entry.
fn parse_claude_thinking(value: &Value) -> (Option<String>, Option<Vec<ThinkingVariantOption>>, Option<String>) {
    let Some(thinking) = value.get("thinking") else {
        return (None, None, None);
    };
    let thinking_type = thinking.get("type").and_then(Value::as_str).unwrap_or("");
    if thinking_type.is_empty() {
        return (None, None, None);
    }
    let variants = match thinking_type {
        "effort_and_mode" => {
            if let Some(options) = thinking.get("effort_options").and_then(Value::as_array) {
                let v: Vec<_> = options.iter().filter_map(|opt| {
                    let value = string_field(opt, &["id", "value"])?;
                    let desc = string_field(opt, &["name", "description", "label"]).unwrap_or_default();
                    Some(ThinkingVariantOption { value, description: desc })
                }).collect();
                if v.is_empty() { None } else { Some(v) }
            } else {
                Some(vec![
                    ThinkingVariantOption { value: "low".to_owned(), description: "Low effort".to_owned() },
                    ThinkingVariantOption { value: "medium".to_owned(), description: "Medium effort".to_owned() },
                    ThinkingVariantOption { value: "high".to_owned(), description: "High effort".to_owned() },
                ])
            }
        }
        "mode" => {
            if let Some(options) = thinking.get("mode_options").and_then(Value::as_array) {
                let v: Vec<_> = options.iter().filter_map(|opt| {
                    let value = string_field(opt, &["id", "value"])?;
                    let desc = string_field(opt, &["name", "description", "label"]).unwrap_or_default();
                    Some(ThinkingVariantOption { value, description: desc })
                }).collect();
                if v.is_empty() { None } else { Some(v) }
            } else {
                Some(vec![ThinkingVariantOption {
                    value: "extended".to_owned(),
                    description: "Extended thinking".to_owned(),
                }])
            }
        }
        "none" => Some(vec![]),
        _ => None,
    };
    let default_thinking = match thinking_type {
        "effort_and_mode" => thinking.get("effort").and_then(Value::as_str).map(str::to_owned),
        "mode" => thinking.get("mode").and_then(Value::as_str).map(str::to_owned),
        _ => None,
    };
    (Some(thinking_type.to_owned()), variants, default_thinking)
}

/// Builds an AIChat catalog model from Claude bootstrap metadata.
fn claude_available_model(
    model: String,
    display_name: String,
    description: String,
    hidden: bool,
    thinking_type: Option<&str>,
    thinking_variants: Option<Vec<ThinkingVariantOption>>,
    default_thinking: Option<String>,
) -> AvailableModel {
    AvailableModel {
        provider_id: String::new(),
        provider_name: String::new(),
        model,
        display_name,
        description,
        hidden,
        is_default: false,
        input_modalities: default_input_modalities(),
        default_thinking_variant: default_thinking.unwrap_or_else(|| DEFAULT_THINKING_VARIANT.to_owned()),
        thinking_variants: thinking_variants.unwrap_or_else(fallback_thinking_variants),
        support_verbosity: false,
        default_verbosity: DEFAULT_VERBOSITY.to_owned(),
        claude_thinking_type: thinking_type.unwrap_or("").to_owned(),
    }
}

/// Checks common entitlement flags to determine if a model can be selected.
fn model_is_available(value: &Value, plan: Option<&str>) -> bool {
    if bool_field(
        value,
        &[
            "disabled",
            "isDisabled",
            "is_disabled",
            "locked",
            "isLocked",
            "is_locked",
            "requiresUpgrade",
            "requires_upgrade",
            "requiresSubscription",
            "requires_subscription",
            "upgradeRequired",
            "upgrade_required",
        ],
    ) == Some(true)
    {
        return false;
    }

    for key in [
        "enabled",
        "isEnabled",
        "is_enabled",
        "available",
        "isAvailable",
        "is_available",
        "selectable",
        "isSelectable",
        "is_selectable",
        "entitled",
        "isEntitled",
        "is_entitled",
        "hasAccess",
        "has_access",
        "canUse",
        "can_use",
    ] {
        if bool_field(value, &[key]) == Some(false) {
            return false;
        }
    }

    if let Some(status) = string_field(
        value,
        &[
            "availability",
            "availability_status",
            "availabilityStatus",
            "access",
            "accessStatus",
            "access_status",
            "status",
            "state",
        ],
    )
    .map(|s| s.to_ascii_lowercase())
    {
        if matches!(
            status.as_str(),
            "disabled"
                | "locked"
                | "unavailable"
                | "not_available"
                | "not-entitled"
                | "not_entitled"
                | "requires_upgrade"
                | "upgrade_required"
                | "paywalled"
        ) {
            return false;
        }
    }

    if let Some(plan) = plan
        && let Some(allowed_plans) = string_array_field(
            value,
            &[
                "plans",
                "allowedPlans",
                "allowed_plans",
                "includedPlans",
                "included_plans",
                "availablePlans",
                "available_plans",
                "subscriptionTiers",
                "subscription_tiers",
                "tiers",
            ],
        )
    {
        let allowed = allowed_plans
            .iter()
            .map(|item| normalize_plan(item))
            .any(|item| item == plan);
        if !allowed {
            return false;
        }
    }

    true
}

/// Scores explicit availability markers higher during fallback model discovery.
fn availability_score(value: &Value) -> i32 {
    let mut score = 0;
    for key in [
        "enabled",
        "isEnabled",
        "available",
        "isAvailable",
        "selectable",
        "isSelectable",
        "entitled",
        "isEntitled",
        "hasAccess",
        "canUse",
    ] {
        if bool_field(value, &[key]) == Some(true) {
            score += 20;
        }
    }
    score
}

/// Scores JSON paths that are more likely to describe selectable models.
fn model_path_score(path: &str) -> i32 {
    let path = path.to_ascii_lowercase();
    let mut score = 0;
    for marker in ["available", "enabled", "entitled", "selectable", "allowed"] {
        if path.contains(marker) {
            score += 30;
        }
    }
    for marker in [
        "all_models",
        "allmodels",
        "unavailable",
        "disabled",
        "locked",
    ] {
        if path.contains(marker) {
            score -= 40;
        }
    }
    score
}

/// Reads the first matching string field from a JSON object.
fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str))
        .map(str::to_owned)
}

/// Reads the first matching boolean field from a JSON object.
fn bool_field(value: &Value, names: &[&str]) -> Option<bool> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_bool))
}

/// Reads the first matching string-array field from a JSON object.
fn string_array_field(value: &Value, names: &[&str]) -> Option<Vec<String>> {
    names.iter().find_map(|name| {
        value.get(*name)?.as_array().map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
    })
}

/// Normalizes plan and tier labels for comparisons.
fn normalize_plan(plan: &str) -> String {
    plan.trim()
        .to_ascii_lowercase()
        .replace("claude", "")
        .replace("plan", "")
        .replace([' ', '-', '_'], "")
}

/// Maps Claude-specific tier labels to app-level tier names.
fn tier_name(value: &str) -> String {
    let normalized = normalize_plan(value);
    if normalized.contains("enterprise") {
        "enterprise".to_owned()
    } else if normalized.contains("business") || normalized.contains("team") {
        "team".to_owned()
    } else if normalized.contains("max") {
        "max".to_owned()
    } else if normalized.contains("pro") {
        "pro".to_owned()
    } else if normalized.contains("free")
        || normalized.contains("default")
        || normalized == "autoapievaluation"
        || normalized.is_empty()
    {
        "free".to_owned()
    } else {
        normalized
    }
}

/// Returns a sortable entitlement rank for Claude account tiers.
fn tier_rank(tier: &str) -> i32 {
    match tier_name(tier).as_str() {
        "free" => 0,
        "pro" => 1,
        "max" => 2,
        "team" => 3,
        "enterprise" => 4,
        _ => 0,
    }
}

/// Converts an internal tier name into display text.
fn display_plan(tier: &str) -> String {
    match tier_name(tier).as_str() {
        "free" => "Free".to_owned(),
        "pro" => "Pro".to_owned(),
        "max" => "Max".to_owned(),
        "team" => "Team".to_owned(),
        "enterprise" => "Enterprise".to_owned(),
        other if !other.is_empty() => other.to_owned(),
        _ => String::new(),
    }
}

/// Removes duplicate model ids while preserving catalog order.
fn dedupe_models(models: &mut Vec<AvailableModel>) {
    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(model.model.clone()));
}

#[cfg(test)]
mod tests {
    use super::{parse_account_info, parse_model_response_for_plan};

    const FREE_BOOTSTRAP: &str = r#"{
        "account": {
            "email_address": "free@example.com",
            "memberships": [{
                "organization": {
                    "capabilities": ["claude_auto_api_evaluation"],
                    "rate_limit_tier": "auto_api_evaluation"
                }
            }]
        },
        "model_selector_config": [{
            "id": "chat",
            "models": [
                {"id": "claude-free", "name": "Free model"},
                {"id": "claude-pro", "name": "Pro model"},
                {"id": "claude-unlisted", "name": "Unlisted model"}
            ]
        }],
        "model_tiers": [
            {"model_id": "claude-free", "minimum_tier": "free"},
            {"model_id": "claude-pro", "minimum_tier": "pro"}
        ]
    }"#;

    #[test]
    fn auto_api_evaluation_displays_as_free() {
        let (_, plan) = parse_account_info(FREE_BOOTSTRAP);

        assert_eq!(plan, "Free");
    }

    #[test]
    fn free_plan_only_shows_allowlisted_models() {
        let models = parse_model_response_for_plan(FREE_BOOTSTRAP, Some("auto_api_evaluation"))
            .expect("free model catalog should parse");

        assert!(
            !models
                .iter()
                .find(|model| model.model == "claude-free")
                .unwrap()
                .hidden
        );
        assert!(
            models
                .iter()
                .find(|model| model.model == "claude-pro")
                .unwrap()
                .hidden
        );
        assert!(
            models
                .iter()
                .find(|model| model.model == "claude-unlisted")
                .unwrap()
                .hidden
        );
    }
}
