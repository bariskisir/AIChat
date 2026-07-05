/** Codex and Claude account panels inside the provider manager. */
import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import * as Renderer from "./render.js";
function codexUrl() { return AppContext.model.appState?.providers?.codexUrl || "codex://chatgpt"; }
function claudeUrl() { return AppContext.model.appState?.providers?.claudeUrl || "claude://claude.ai"; }
function claudeCodeUrl() { return AppContext.model.appState?.providers?.claudeCodeUrl || "claudecode://anthropic"; }
function antigravityUrl() { return AppContext.model.appState?.providers?.antigravityUrl || "antigravity://google"; }
// Wires Codex and Claude account buttons to backend commands.
export function bind(refs, setStatus) {
    refs.btnCodexRefresh.addEventListener("click", () => refreshCodexAccount(refs, setStatus));
    refs.btnClaudeLogin.addEventListener("click", () => startClaudeLogin(refs, setStatus));
    refs.btnClaudeRefresh.addEventListener("click", () => refreshClaudeAccount(refs, setStatus));
    refs.btnClaudeSignOut.addEventListener("click", () => signOutClaude(refs, setStatus));
    refs.btnClaudeCodeRefresh.addEventListener("click", () => refreshClaudeCodeAccount(refs, setStatus));
    refs.btnAntigravityRefresh.addEventListener("click", () => refreshAntigravityAccount(refs, setStatus));
}
// Reports whether the editor currently targets a dedicated account provider.
export function isSpecialForm(refs) {
    return isCodexForm(refs) || isClaudeForm(refs) || isClaudeCodeForm(refs) || isAntigravityForm(refs);
}
// Reports whether a template is backed by a dedicated account provider.
export function isSpecialTemplate(template) {
    return isCodexTemplate(template) || isClaudeTemplate(template) || isClaudeCodeTemplate(template) || isAntigravityTemplate(template);
}
// Applies fixed editor values for dedicated account provider templates.
export function applyTemplate(refs, template) {
    if (!isSpecialTemplate(template)) {
        return;
    }
    refs.providerName.value = template.name;
    refs.providerApiKey.value = "";
    refs.providerCustomHeaders.value = "";
}
// Shows account panels and hides OpenAI-compatible fields for dedicated providers.
export function render(refs) {
    refs.providerName.readOnly = false;
    refs.providerApiUrl.readOnly = false;
    refs.providerApiKey.readOnly = false;
    const isCodex = isCodexForm(refs);
    const isClaude = isClaudeForm(refs);
    const isClaudeCode = isClaudeCodeForm(refs);
    const isAntigravity = isAntigravityForm(refs);
    const isEnv = isEnvForm(refs);
    const isSpecial = isCodex || isClaude || isClaudeCode || isAntigravity;
    refs.providerTemplateField.hidden = isSpecial;
    refs.codexAccountPanel.hidden = !isCodex;
    refs.claudeLoginRow.hidden = !isClaude;
    refs.claudeCodeLoginRow.hidden = !isClaudeCode;
    refs.antigravityLoginRow.hidden = !isAntigravity;
    refs.providerNameField.hidden = isSpecial;
    refs.providerApiUrlField.hidden = isSpecial;
    refs.providerApiKeyField.hidden = isSpecial;
    refs.providerCustomHeadersField.hidden = isSpecial && !isEnv;
    refs.providerModelFilterField.hidden = isSpecial && !isEnv;
    refs.providerName.required = !isSpecial;
    refs.providerApiUrl.required = !isSpecial;
    refs.providerEnvWarning.hidden = !isEnv;
    refs.providerClaudeWarning.hidden = !(isClaude || isClaudeCode);
    refs.providerAntigravityWarning.hidden = !isAntigravity;
    if (!isSpecial) {
        refs.providerTemplateField.hidden = false;
        if (isEnv) {
            showEnvProviderWarning(refs);
        }
        return;
    }
    if (isCodex) {
        refs.providerName.value = "Codex";
        refs.providerApiUrl.value = codexUrl();
    }
    else if (isClaudeCode) {
        refs.providerName.value = "ClaudeCode";
        refs.providerApiUrl.value = claudeCodeUrl();
    }
    else if (isAntigravity) {
        refs.providerName.value = "Antigravity";
        refs.providerApiUrl.value = antigravityUrl();
    }
    else {
        refs.providerName.value = "ClaudeWeb";
        refs.providerApiUrl.value = claudeUrl();
    }
    refs.providerApiKey.value = "";
    refs.providerCustomHeaders.value = "";
    refs.providerCustomHeadersEnabled.checked = false;
    refs.providerFilterModels.checked = false;
    syncSpecialProviderId(refs);
    renderCodexAccount(refs, isCodex);
    renderClaudeAccount(refs, isClaude);
    renderClaudeCodeAccount(refs, isClaudeCode);
    renderAntigravityAccount(refs, isAntigravity);
}
// Returns whether the current editor values represent the Codex provider.
function isCodexForm(refs) {
    return refs.providerApiUrl.value.trim().toLocaleLowerCase() === codexUrl()
        || refs.providerTemplate.value === "Codex";
}
// Returns whether the current editor values represent the Claude Web provider.
function isClaudeForm(refs) {
    return refs.providerApiUrl.value.trim().toLocaleLowerCase() === claudeUrl()
        || refs.providerTemplate.value === "Claude";
}
// Returns whether the current editor values represent the Claude Code provider.
function isClaudeCodeForm(refs) {
    return refs.providerApiUrl.value.trim().toLocaleLowerCase() === claudeCodeUrl()
        || refs.providerTemplate.value === "ClaudeCode";
}
// Returns whether a template is the dedicated Codex template.
function isCodexTemplate(template) {
    return template.apiUrl.trim().toLocaleLowerCase() === codexUrl();
}
// Returns whether a template is the dedicated Claude Web template.
function isClaudeTemplate(template) {
    return template.apiUrl.trim().toLocaleLowerCase() === claudeUrl();
}
// Returns whether a template is the dedicated Claude Code template.
function isClaudeCodeTemplate(template) {
    return template.apiUrl.trim().toLocaleLowerCase() === claudeCodeUrl();
}
// Returns whether the current editor values represent the Antigravity provider.
function isAntigravityForm(refs) {
    return refs.providerApiUrl.value.trim().toLocaleLowerCase() === antigravityUrl()
        || refs.providerTemplate.value === "Antigravity";
}
// Returns whether a template is the dedicated Antigravity template.
function isAntigravityTemplate(template) {
    return template.apiUrl.trim().toLocaleLowerCase() === antigravityUrl();
}
// Selects the saved special provider row after login creates it.
function syncSpecialProviderId(refs) {
    const provider = isCodexForm(refs)
        ? specialProvider(codexUrl())
        : isClaudeCodeForm(refs)
            ? specialProvider(claudeCodeUrl())
            : isAntigravityForm(refs)
                ? specialProvider(antigravityUrl())
                : specialProvider(claudeUrl());
    if (provider && !refs.providerId.value) {
        refs.providerId.value = provider.id;
        refs.providerEditorTitle.textContent = "Edit Provider";
    }
    renderSelectedProvider(refs, refs.providerId.value);
}
// Renders the Codex (local CLI credential) account details.
function renderCodexAccount(refs, isCodex) {
    refs.codexAccountPanel.hidden = !isCodex;
    if (!isCodex)
        return;
    const state = AppContext.model.appState;
    const account = state?.codexAccount;
    const available = Boolean(account?.available);
    refs.codexAccountStatus.textContent = available
        ? "Reading ~/.codex/auth.json"
        : "Sign in with Codex CLI.";
    refs.codexAccountEmail.textContent = account?.email || "--";
    refs.codexAccountPlan.textContent = account?.plan || "--";
    refs.codexAccountLimit.textContent = account?.limitLabel || "--";
    refs.codexAccountModels.textContent = state ? modelList(state, codexUrl()) : "--";
}
// Renders the signed-in Claude account details.
function renderClaudeAccount(refs, isClaude) {
    const state = AppContext.model.appState;
    const loggedIn = Boolean(state?.claudeAccount.loggedIn);
    refs.btnClaudeLogin.hidden = !isClaude || loggedIn;
    refs.claudeAccountPanel.hidden = !isClaude || !loggedIn;
    if (!isClaude || !loggedIn || !state) {
        return;
    }
    refs.claudeAccountEmail.textContent = state.claudeAccount.email || "--";
    refs.claudeAccountPlan.textContent = state.claudeAccount.plan || "--";
    refs.claudeAccountModels.textContent = modelList(state, claudeUrl());
}
// Renders the Claude Code (local CLI credential) account details.
function renderClaudeCodeAccount(refs, isClaudeCode) {
    refs.claudeCodeAccountPanel.hidden = !isClaudeCode;
    if (!isClaudeCode) {
        return;
    }
    const state = AppContext.model.appState;
    const account = state?.claudeCodeAccount;
    const available = Boolean(account?.available);
    refs.claudeCodeAccountStatus.textContent = available
        ? "Reading ~/.claude/.credentials.json"
        : "Sign in with the Claude Code CLI.";
    refs.claudeCodeAccountPlan.textContent = account?.plan || "--";
    refs.claudeCodeAccountLimit.textContent = account?.limitLabel || "--";
    refs.claudeCodeAccountModels.textContent = state ? modelList(state, claudeCodeUrl()) : "--";
}
// Renders the Antigravity (Gemini Code Assist) account details.
function renderAntigravityAccount(refs, isAntigravity) {
    refs.antigravityAccountPanel.hidden = !isAntigravity;
    if (!isAntigravity) {
        return;
    }
    const state = AppContext.model.appState;
    const account = state?.antigravityAccount;
    const available = Boolean(account?.available);
    refs.antigravityAccountStatus.textContent = available
        ? "Reading from Windows Credential Manager."
        : "Sign in with the Antigravity CLI.";
    refs.antigravityEmail.textContent = account?.email || "--";
    refs.antigravityProjectId.textContent = account?.projectId || "--";
    refs.antigravityVersion.textContent = account?.cliVersion || "--";
    refs.antigravityPlan.textContent = account?.plan || "--";
    refs.antigravityLimit.textContent = account?.limitLabel || "--";
    refs.antigravityModels.textContent = state ? modelList(state, antigravityUrl()) : "--";
}
// Refreshes Antigravity models and usage from the provider's API key.
async function refreshAntigravityAccount(refs, setStatus) {
    await refreshAccount(refs, setStatus, antigravityUrl(), refs.btnAntigravityRefresh, "Sign in with the Antigravity CLI first.", "Refreshing Antigravity account...");
}
// Refreshes Claude Code models and usage from local CLI credentials.
async function refreshClaudeCodeAccount(refs, setStatus) {
    await refreshAccount(refs, setStatus, claudeCodeUrl(), refs.btnClaudeCodeRefresh, "Sign in with the Claude Code CLI first.", "Refreshing Claude Code account...");
}
// Starts the Claude.ai sign-in flow from the provider editor.
async function startClaudeLogin(refs, setStatus) {
    await runAccountAction(refs, setStatus, "Launching Chrome for Claude login...", Api.startClaudeLogin);
}
// Signs out of Claude from the provider editor.
async function signOutClaude(refs, setStatus) {
    await runAccountAction(refs, setStatus, "Signing out of Claude...", Api.signOutClaude);
}
// Refreshes Codex account models and usage from local auth.json.
async function refreshCodexAccount(refs, setStatus) {
    await refreshAccount(refs, setStatus, codexUrl(), refs.btnCodexRefresh, "Sign in with Codex CLI first.", "Refreshing Codex account...");
}
// Refreshes Claude account metadata and model list.
async function refreshClaudeAccount(refs, setStatus) {
    await refreshAccount(refs, setStatus, claudeUrl(), refs.btnClaudeRefresh, "Sign in with Claude first.", "Refreshing Claude account...");
}
// Runs a sign-in or sign-out action and rerenders the provider manager.
async function runAccountAction(refs, setStatus, pendingMessage, action) {
    setStatus(pendingMessage);
    try {
        const snapshot = await action();
        renderSnapshot(refs, snapshot);
        setStatus(snapshot.status);
    }
    catch (error) {
        setStatus(String(error), true);
    }
}
// Refreshes a saved account provider by provider URL.
async function refreshAccount(refs, setStatus, apiUrl, button, missingMessage, pendingMessage) {
    const provider = specialProvider(apiUrl);
    if (!provider) {
        setStatus(missingMessage, true);
        return;
    }
    setStatus(pendingMessage);
    try {
        button.disabled = true;
        const snapshot = await Api.refreshProviderModels(provider.id);
        renderSnapshot(refs, snapshot);
        setStatus(snapshot.status);
    }
    catch (error) {
        setStatus(String(error), true);
    }
    finally {
        button.disabled = false;
    }
}
// Renders a backend snapshot after an account action.
function renderSnapshot(refs, snapshot) {
    Renderer.renderState(refs, AppContext.model, snapshot);
    Renderer.renderProviders(refs, snapshot);
    render(refs);
}
// Returns a saved dedicated account provider by URL.
function specialProvider(apiUrl) {
    return AppContext.model.appState?.providers?.providers?.find((item) => {
        return item.apiUrl.trim().toLocaleLowerCase() === apiUrl;
    });
}
// Formats visible account model ids as a comma-separated account field.
function modelList(state, apiUrl) {
    const provider = state.providers.providers.find((item) => {
        return item.apiUrl.trim().toLocaleLowerCase() === apiUrl;
    });
    const models = provider?.models
        .filter((model) => !model.hidden)
        .map((model) => model.displayName || model.model)
        .filter(Boolean) || [];
    return models.length ? models.join(", ") : "--";
}
// Returns whether the current editor values represent an env-based provider.
function isEnvForm(refs) {
    const id = refs.providerId.value.trim();
    if (!id)
        return false;
    const provider = AppContext.model.appState?.providers?.providers?.find((p) => p.id === id);
    return Boolean(provider?.isEnv);
}

// Shows a warning for env-based providers and locks name/url/API key fields.
function showEnvProviderWarning(refs) {
    const provider = AppContext.model.appState?.providers?.providers
        .find((p) => p.id === refs.providerId.value.trim());
    if (!provider)
        return;
    refs.providerName.value = provider.name;
    refs.providerName.readOnly = true;
    refs.providerApiUrl.value = provider.apiUrl;
    refs.providerApiUrl.readOnly = true;
    refs.providerApiKey.value = `Using ${provider.envVar}`;
    refs.providerApiKey.readOnly = true;
    refs.providerTemplateField.hidden = true;
    refs.providerActions.hidden = false;
    refs.providerCustomHeadersField.hidden = false;
    refs.providerModelFilterField.hidden = false;
    refs.providerEnvWarning.hidden = false;
}

// Marks the provider currently loaded in the editor.
function renderSelectedProvider(refs, providerId) {
    refs.providerList.querySelectorAll("[data-provider-id]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.providerId === providerId);
    });
}
