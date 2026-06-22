/** Provider manager behavior and provider editor commands. */

import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import { type Refs } from "./dom.js";
import * as ProviderAccountPanels from "./provider-account-panels.js";
import * as ProviderTemplateDropdown from "./provider-template-dropdown.js";
import * as ProviderTemplates from "./provider-templates.js";
import * as Renderer from "./render.js";
import { type UiModel } from "./render.js";

// Wires provider manager controls to backend commands.
export function bind(refs: Refs, model: UiModel): void {
  refs.btnProviders.addEventListener("click", () => openManager(refs, model));
  refs.btnAddProvider.addEventListener("click", () => openEditor(refs, model));
  refs.btnCloseProviders.addEventListener("click", () => refs.providerDialog.close());
  refs.btnCancelProvider.addEventListener("click", () => refs.providerDialog.close());
  refs.providerList.addEventListener("click", (event) => handleProviderClick(refs, model, event));
  refs.providerForm.addEventListener("submit", saveProvider);
  refs.providerTemplate.addEventListener("change", () => applyTemplate(refs));
  refs.providerApiUrl.addEventListener("input", () => {
    ProviderAccountPanels.render(refs);
    updateTokenMask(refs);
  });
  ProviderTemplateDropdown.bind(refs, () => applyTemplate(refs));
  ProviderAccountPanels.bind(refs, (message, isError) => renderProviderStatus(refs, message, isError));
}

// Keeps the account panel in sync after backend-pushed snapshots.
export function sync(refs: Refs): void {
  if (refs.providerDialog.open) {
    ProviderAccountPanels.render(refs);
  }
}

// Opens the provider manager dialog.
function openManager(refs: Refs, model: UiModel): void {
  ProviderTemplateDropdown.populate(refs);
  Renderer.renderProviders(refs, model.appState);
  const providerId = model.appState?.providers.activeProviderId || model.appState?.providers.providers[0]?.id || "";
  openEditor(refs, model, providerId);
  if (!providerId) {
    renderProviderStatus(refs, "Select a provider or add a new one.");
  }
  refs.providerDialog.showModal();
}

// Handles provider selection and deletion.
function handleProviderClick(refs: Refs, model: UiModel, event: MouseEvent): void {
  const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-provider-id]");
  const deleteProviderId = deleteButton?.dataset.deleteProviderId;
  if (deleteProviderId) {
    void deleteProvider(refs, model, deleteProviderId);
    return;
  }
  const providerItem = (event.target as HTMLElement).closest<HTMLElement>("[data-provider-id]");
  const providerId = providerItem?.dataset.providerId;
  if (providerId) {
    openEditor(refs, model, providerId);
  }
}

// Opens the provider editor with blank or existing values.
function openEditor(refs: Refs, model: UiModel, providerId = ""): void {
  const provider = model.appState?.providers.providers.find((item) => item.id === providerId);
  ProviderTemplateDropdown.populate(refs);
  refs.providerEditorTitle.textContent = provider ? "Edit Provider" : "New Provider";
  refs.providerId.value = provider?.id || "";
  refs.providerName.value = provider?.name || "";
  refs.providerApiUrl.value = provider?.apiUrl || "";
  refs.providerApiKey.value = provider?.apiKey || "";
  refs.providerCustomHeaders.value = provider ? headersText(provider.customHeaders) : "";
  refs.providerTemplate.value = ProviderTemplates.byApiUrl(provider?.apiUrl || "")?.name || "";
  ProviderTemplateDropdown.resetSearch(refs);
  ProviderTemplateDropdown.renderLabel(refs);
  ProviderAccountPanels.render(refs);
  updateTokenMask(refs);
  renderSelectedProvider(refs, provider?.id || "");
  renderProviderStatus(refs, editorStatus(provider));
}

// Applies the selected provider template to the editor form.
function applyTemplate(refs: Refs): void {
  const template = ProviderTemplates.items.find((item) => item.name === refs.providerTemplate.value);
  if (!template) {
    return;
  }
  if (ProviderAccountPanels.isSpecialTemplate(template)) {
    ProviderAccountPanels.applyTemplate(refs, template);
  } else if (!refs.providerName.value.trim()) {
    refs.providerName.value = template.name;
  }
  refs.providerApiUrl.value = template.apiUrl;
  ProviderAccountPanels.render(refs);
  applyOpenCodeDefaults(refs, template);
  updateTokenMask(refs);
}

// Saves the provider editor form.
async function saveProvider(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const refs = AppContext.refs;
  const provider: ProviderInput = {
    id: refs.providerId.value,
    name: refs.providerName.value,
    apiUrl: refs.providerApiUrl.value,
    apiKey: refs.providerApiKey.value,
    customHeaders: refs.providerCustomHeaders.value,
  };
  renderProviderStatus(refs, "Checking provider models...");
  try {
    const snapshot = await Api.saveProvider(provider);
    Renderer.renderState(refs, AppContext.model, snapshot);
    Renderer.renderProviders(refs, snapshot);
    openEditor(refs, AppContext.model, savedProviderId(snapshot, provider));
    renderProviderStatus(refs, snapshot.status);
  } catch (error) {
    renderProviderStatus(refs, String(error), true);
  }
}

// Deletes a provider and keeps the manager open on the next available provider.
async function deleteProvider(refs: Refs, model: UiModel, providerId: string): Promise<void> {
  try {
    const snapshot = await Api.deleteProvider(providerId);
    Renderer.renderState(refs, model, snapshot);
    Renderer.renderProviders(refs, snapshot);
    const nextProviderId = snapshot.providers.activeProviderId || snapshot.providers.providers[0]?.id || "";
    openEditor(refs, model, nextProviderId);
    renderProviderStatus(refs, snapshot.status);
  } catch (error) {
    renderProviderStatus(refs, String(error), true);
  }
}

// Applies OpenCode-specific defaults without overwriting user-entered values.
function applyOpenCodeDefaults(refs: Refs, template: ProviderTemplates.Template): void {
  if (template.name !== "opencodezen") {
    return;
  }
  if (!refs.providerApiKey.value.trim()) {
    refs.providerApiKey.value = "public";
  }
  if (!refs.providerCustomHeaders.value.trim()) {
    refs.providerCustomHeaders.value = JSON.stringify({ "x-opencode-session": "" });
  }
}

// Masks provider tokens except for OpenCode Zen while retaining normal edit and clipboard behavior.
function updateTokenMask(refs: Refs): void {
  const template = ProviderTemplates.byApiUrl(refs.providerApiUrl.value);
  const isOpenCodeZen =
    refs.providerId.value === "opencode-zen"
    || refs.providerTemplate.value === "opencodezen"
    || template?.name === "opencodezen";
  refs.providerApiKey.type = isOpenCodeZen ? "text" : "password";
}

// Finds the saved provider id after creating or updating provider input.
function savedProviderId(snapshot: AppSnapshot, input: ProviderInput): string {
  if (input.id) {
    return input.id;
  }
  return [...snapshot.providers.providers]
    .reverse()
    .find((provider) => provider.name === input.name.trim() && provider.apiUrl === input.apiUrl.trim().replace(/\/+$/, ""))?.id || snapshot.providers.activeProviderId;
}

// Renders provider-manager status text.
function renderProviderStatus(refs: Refs, message: string, isError = false): void {
  refs.providerStatusText.textContent = message || "Ready.";
  refs.providerStatusRow.classList.toggle("is-error", isError);
}

// Returns the appropriate editor helper status for a provider.
function editorStatus(provider: ProviderConfig | undefined): string {
  if (!provider) {
    return "New provider details.";
  }
  if (provider.error) {
    return provider.error;
  }
  return provider.enabled ? "Edit provider details." : "Provider is disabled until a successful model refresh.";
}

// Serializes provider headers into the editor JSON field.
function headersText(headers: CustomHeader[]): string {
  if (!headers.length) {
    return "";
  }
  const value: Record<string, string> = {};
  for (const header of headers) {
    value[header.name] = header.value;
  }
  return JSON.stringify(value);
}

// Marks the provider currently loaded in the editor.
function renderSelectedProvider(refs: Refs, providerId: string): void {
  refs.providerList.querySelectorAll<HTMLElement>("[data-provider-id]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.providerId === providerId);
  });
}
