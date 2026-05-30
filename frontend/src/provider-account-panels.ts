/** Codex and Claude account panels inside the provider manager. */

import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import { type Refs } from "./dom.js";
import * as ProviderTemplates from "./provider-templates.js";
import * as Renderer from "./render.js";

const CODEX_URL = "codex://chatgpt";
const CLAUDE_URL = "claude://claude.ai";

// Wires Codex and Claude account buttons to backend auth commands.
export function bind(refs: Refs, setStatus: (message: string, isError?: boolean) => void): void {
  refs.btnCodexLogin.addEventListener("click", () => startCodexLogin(refs, setStatus));
  refs.btnCodexRefresh.addEventListener("click", () => refreshCodexAccount(refs, setStatus));
  refs.btnCodexSignOut.addEventListener("click", () => signOutCodex(refs, setStatus));
  refs.btnClaudeLogin.addEventListener("click", () => startClaudeLogin(refs, setStatus));
  refs.btnClaudeRefresh.addEventListener("click", () => refreshClaudeAccount(refs, setStatus));
  refs.btnClaudeSignOut.addEventListener("click", () => signOutClaude(refs, setStatus));
}

// Reports whether the editor currently targets a dedicated account provider.
export function isSpecialForm(refs: Refs): boolean {
  return isCodexForm(refs) || isClaudeForm(refs);
}

// Reports whether a template is backed by a dedicated account provider.
export function isSpecialTemplate(template: ProviderTemplates.Template): boolean {
  return isCodexTemplate(template) || isClaudeTemplate(template);
}

// Applies fixed editor values for dedicated account provider templates.
export function applyTemplate(refs: Refs, template: ProviderTemplates.Template): void {
  if (!isSpecialTemplate(template)) {
    return;
  }
  refs.providerName.value = template.name;
  refs.providerApiKey.value = "";
  refs.providerCustomHeaders.value = "";
}

// Shows account panels and hides OpenAI-compatible fields for dedicated providers.
export function render(refs: Refs): void {
  const isCodex = isCodexForm(refs);
  const isClaude = isClaudeForm(refs);
  const isSpecial = isCodex || isClaude;
  refs.providerTemplateField.hidden = isSpecial;
  refs.codexLoginRow.hidden = !isCodex;
  refs.claudeLoginRow.hidden = !isClaude;
  refs.providerNameField.hidden = isSpecial;
  refs.providerApiUrlField.hidden = isSpecial;
  refs.providerApiKeyField.hidden = isSpecial;
  refs.providerCustomHeadersField.hidden = isSpecial;
  refs.providerActions.hidden = isSpecial;
  refs.providerName.required = !isSpecial;
  refs.providerApiUrl.required = !isSpecial;
  if (!isSpecial) {
    refs.providerTemplateField.hidden = false;
    return;
  }
  refs.providerName.value = isCodex ? "Codex" : "Claude";
  refs.providerApiUrl.value = isCodex ? CODEX_URL : CLAUDE_URL;
  refs.providerApiKey.value = "";
  refs.providerCustomHeaders.value = "";
  syncSpecialProviderId(refs);
  renderCodexAccount(refs, isCodex);
  renderClaudeAccount(refs, isClaude);
}

// Returns whether the current editor values represent the Codex provider.
function isCodexForm(refs: Refs): boolean {
  return refs.providerApiUrl.value.trim().toLocaleLowerCase() === CODEX_URL
    || refs.providerTemplate.value === "Codex";
}

// Returns whether the current editor values represent the Claude provider.
function isClaudeForm(refs: Refs): boolean {
  return refs.providerApiUrl.value.trim().toLocaleLowerCase() === CLAUDE_URL
    || refs.providerTemplate.value === "Claude";
}

// Returns whether a template is the dedicated Codex template.
function isCodexTemplate(template: ProviderTemplates.Template): boolean {
  return template.apiUrl.trim().toLocaleLowerCase() === CODEX_URL;
}

// Returns whether a template is the dedicated Claude template.
function isClaudeTemplate(template: ProviderTemplates.Template): boolean {
  return template.apiUrl.trim().toLocaleLowerCase() === CLAUDE_URL;
}

// Selects the saved special provider row after login creates it.
function syncSpecialProviderId(refs: Refs): void {
  const provider = isCodexForm(refs) ? specialProvider(CODEX_URL) : specialProvider(CLAUDE_URL);
  if (provider && !refs.providerId.value) {
    refs.providerId.value = provider.id;
    refs.providerEditorTitle.textContent = "Edit Provider";
  }
  renderSelectedProvider(refs, refs.providerId.value);
}

// Renders the signed-in Codex account details.
function renderCodexAccount(refs: Refs, isCodex: boolean): void {
  const state = AppContext.model.appState;
  const loggedIn = Boolean(state?.account.loggedIn);
  refs.btnCodexLogin.hidden = !isCodex || loggedIn;
  refs.codexAccountPanel.hidden = !isCodex || !loggedIn;
  if (!isCodex || !loggedIn || !state) {
    return;
  }
  const usage = codexUsageParts(state.catalog.limitLabel);
  refs.codexAccountEmail.textContent = state.account.email || "--";
  refs.codexAccountPlan.textContent = usage.plan;
  refs.codexAccountLimit.textContent = usage.limit;
  refs.codexAccountReset.textContent = usage.reset;
  refs.codexAccountModels.textContent = modelList(state, CODEX_URL);
}

// Renders the signed-in Claude account details.
function renderClaudeAccount(refs: Refs, isClaude: boolean): void {
  const state = AppContext.model.appState;
  const loggedIn = Boolean(state?.claudeAccount.loggedIn);
  refs.btnClaudeLogin.hidden = !isClaude || loggedIn;
  refs.claudeAccountPanel.hidden = !isClaude || !loggedIn;
  if (!isClaude || !loggedIn || !state) {
    return;
  }
  refs.claudeAccountEmail.textContent = state.claudeAccount.email || "--";
  refs.claudeAccountPlan.textContent = state.claudeAccount.plan || "--";
  refs.claudeAccountModels.textContent = modelList(state, CLAUDE_URL);
}

// Starts the Codex ChatGPT sign-in flow from the provider editor.
async function startCodexLogin(refs: Refs, setStatus: (message: string, isError?: boolean) => void): Promise<void> {
  await runAccountAction(refs, setStatus, "Opening ChatGPT sign-in...", Api.startLogin);
}

// Signs out of the Codex ChatGPT account from the provider editor.
async function signOutCodex(refs: Refs, setStatus: (message: string, isError?: boolean) => void): Promise<void> {
  await runAccountAction(refs, setStatus, "Signing out of ChatGPT...", Api.signOut);
}

// Starts the Claude.ai sign-in flow from the provider editor.
async function startClaudeLogin(refs: Refs, setStatus: (message: string, isError?: boolean) => void): Promise<void> {
  await runAccountAction(refs, setStatus, "Launching Chrome for Claude login...", Api.startClaudeLogin);
}

// Signs out of Claude from the provider editor.
async function signOutClaude(refs: Refs, setStatus: (message: string, isError?: boolean) => void): Promise<void> {
  await runAccountAction(refs, setStatus, "Signing out of Claude...", Api.signOutClaude);
}

// Refreshes Codex account limits and model metadata from ChatGPT.
async function refreshCodexAccount(refs: Refs, setStatus: (message: string, isError?: boolean) => void): Promise<void> {
  await refreshAccount(refs, setStatus, CODEX_URL, refs.btnCodexRefresh, "Sign in with ChatGPT first.", "Refreshing Codex account...");
}

// Refreshes Claude account metadata and model list.
async function refreshClaudeAccount(refs: Refs, setStatus: (message: string, isError?: boolean) => void): Promise<void> {
  await refreshAccount(refs, setStatus, CLAUDE_URL, refs.btnClaudeRefresh, "Sign in with Claude first.", "Refreshing Claude account...");
}

// Runs a sign-in or sign-out action and rerenders the provider manager.
async function runAccountAction(
  refs: Refs,
  setStatus: (message: string, isError?: boolean) => void,
  pendingMessage: string,
  action: () => Promise<AppSnapshot>,
): Promise<void> {
  setStatus(pendingMessage);
  try {
    const snapshot = await action();
    renderSnapshot(refs, snapshot);
    setStatus(snapshot.status);
  } catch (error) {
    setStatus(String(error), true);
  }
}

// Refreshes a saved account provider by provider URL.
async function refreshAccount(
  refs: Refs,
  setStatus: (message: string, isError?: boolean) => void,
  apiUrl: string,
  button: HTMLButtonElement,
  missingMessage: string,
  pendingMessage: string,
): Promise<void> {
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
  } catch (error) {
    setStatus(String(error), true);
  } finally {
    button.disabled = false;
  }
}

// Renders a backend snapshot after an account action.
function renderSnapshot(refs: Refs, snapshot: AppSnapshot): void {
  Renderer.renderState(refs, AppContext.model, snapshot);
  Renderer.renderProviders(refs, snapshot);
  render(refs);
}

// Returns a saved dedicated account provider by URL.
function specialProvider(apiUrl: string): ProviderConfig | undefined {
  return AppContext.model.appState?.providers.providers.find((item) => {
    return item.apiUrl.trim().toLocaleLowerCase() === apiUrl;
  });
}

// Formats visible account model ids as a comma-separated account field.
function modelList(state: AppSnapshot, apiUrl: string): string {
  const provider = state.providers.providers.find((item) => {
    return item.apiUrl.trim().toLocaleLowerCase() === apiUrl;
  });
  const models = provider?.models
    .filter((model) => !model.hidden)
    .map((model) => model.displayName || model.model)
    .filter(Boolean) || [];
  return models.length ? models.join(", ") : "--";
}

interface CodexUsageParts {
  plan: string;
  limit: string;
  reset: string;
}

// Splits the compact ChatGPT usage label into dedicated account fields.
function codexUsageParts(label: string): CodexUsageParts {
  const windows = codexUsageWindows(label);
  const firstWindow = windows[0];
  const plan = firstWindow
    ? label.slice(0, firstWindow.index).replace(/,\s*$/, "").trim() || "--"
    : label.split(",")[0]?.trim() || "--";
  return {
    plan,
    limit: windows.length ? windows.map((window) => `${window.window}: ${window.percent}%`).join(", ") : "--",
    reset: windows.length ? windows.map(formatCodexUsageReset).join(", ") : "--",
  };
}

interface CodexUsageWindow {
  index: number;
  window: string;
  percent: string;
  reset: string;
}

// Extracts all ChatGPT usage windows from the compact backend label.
function codexUsageWindows(label: string): CodexUsageWindow[] {
  const windows: CodexUsageWindow[] = [];
  const usagePattern = /(?:^|,\s*)(\d+(?:\.\d+)?[mhd]):\s*(\d+(?:\.\d+)?)%(?:\s+resets\s+([^,]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = usagePattern.exec(label)) !== null) {
    windows.push({
      index: match.index,
      window: match[1],
      percent: match[2],
      reset: match[3]?.trim() || "--",
    });
  }
  return windows;
}

// Formats a usage-window reset value for the Codex account panel.
function formatCodexUsageReset(window: CodexUsageWindow): string {
  return `${window.window}: ${window.reset}`;
}

// Marks the provider currently loaded in the editor.
function renderSelectedProvider(refs: Refs, providerId: string): void {
  refs.providerList.querySelectorAll<HTMLElement>("[data-provider-id]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.providerId === providerId);
  });
}
