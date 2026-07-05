/** Provider manager behavior and provider editor commands. */
import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import * as Constants from "./constants.js";
import * as ProviderAccountPanels from "./provider-account-panels.js";
import * as Renderer from "./render.js";
import * as SearchableDropdown from "./searchable-dropdown.js";

function snapshotDefaultRegex() {
    return AppContext.model.appState?.providers?.defaultModelFilterRegex || "free|big-pickle";
}
function getTemplates() {
    return AppContext.model.appState?.providers?.templates || [];
}
function templateByApiUrl(apiUrl) {
    const normalized = apiUrl.trim().replace(/\/+$/, "");
    return getTemplates().find((t) => t.apiUrl.replace(/\/+$/, "") === normalized);
}
// Wires provider manager controls to backend commands.
export function bind(refs, model) {
    refs.btnProviders.addEventListener("click", () => openManager(refs, model));
    refs.btnAddProvider.addEventListener("click", () => openEditor(refs, model));
    refs.btnCloseProviders.addEventListener("click", () => refs.providerDialog.close());
    refs.btnCancelProvider.addEventListener("click", () => refs.providerDialog.close());
    refs.providerList.addEventListener("click", (event) => handleProviderClick(refs, model, event));
    refs.providerForm.addEventListener("submit", saveProvider);
    refs.providerTemplate.addEventListener("change", () => applyTemplate(refs));
    refs.providerFilterModels.addEventListener("change", () => updateModelFilter(refs));
    refs.providerCustomHeadersEnabled.addEventListener("change", () => updateCustomHeaders(refs));
    refs.providerApiUrl.addEventListener("input", () => {
        ProviderAccountPanels.render(refs);
        updateTokenMask(refs);
    });
    bindTemplateDropdown(refs);
    ProviderAccountPanels.bind(refs, (message, isError) => renderProviderStatus(refs, message, isError));
}
// Keeps the account panel in sync after backend-pushed snapshots.
export function sync(refs) {
    if (refs.providerDialog.open) {
        const provider = AppContext.model.appState?.providers?.providers
            ?.find((p) => p.id === refs.providerId.value.trim());
        if (provider) {
            refs.providerEnabled.checked = provider.enabled !== false;
        }
        ProviderAccountPanels.render(refs);
    }
}
// Opens the provider manager dialog.
function openManager(refs, model) {
    populateTemplateDropdown(refs);
    Renderer.renderProviders(refs, model.appState);
    const providerId = model.appState?.providers?.activeProviderId || model.appState?.providers?.providers[0]?.id || "";
    openEditor(refs, model, providerId);
    if (!providerId) {
        renderProviderStatus(refs, "Select a provider or add a new one.");
    }
    refs.providerDialog.showModal();
}
// Handles provider selection and deletion.
function handleProviderClick(refs, model, event) {
    const deleteButton = event.target.closest("[data-delete-provider-id]");
    const deleteProviderId = deleteButton?.dataset.deleteProviderId;
    if (deleteProviderId) {
        void deleteProvider(refs, model, deleteProviderId);
        return;
    }
    const providerItem = event.target.closest("[data-provider-id]");
    const providerId = providerItem?.dataset.providerId;
    if (providerId) {
        openEditor(refs, model, providerId);
    }
}
// Opens the provider editor with blank or existing values.
function openEditor(refs, model, providerId = "") {
    const provider = model.appState?.providers?.providers?.find((item) => item.id === providerId);
    populateTemplateDropdown(refs);
    refs.providerEditorTitle.textContent = provider ? "Edit Provider" : "New Provider";
    refs.providerId.value = provider?.id || "";
    refs.providerName.value = provider?.name || "";
    refs.providerApiUrl.value = provider?.apiUrl || "";
    refs.providerApiKey.value = provider?.apiKey || "";
    refs.providerCustomHeaders.value = provider ? headersText(provider.customHeaders) : "";
    refs.providerCustomHeadersEnabled.checked = Boolean(provider?.customHeadersEnabled);
    refs.providerFilterModels.checked = Boolean(provider?.filterModels);
    refs.providerModelFilterRegex.value = provider?.modelFilterRegex || snapshotDefaultRegex();
    refs.providerEnabled.checked = provider?.enabled !== false;
    refs.providerTemplate.value = templateByApiUrl(provider?.apiUrl || "")?.name || "";
    resetTemplateSearch(refs);
    renderTemplateLabel(refs);
    ProviderAccountPanels.render(refs);
    updateTokenMask(refs);
    updateModelFilter(refs);
    updateCustomHeaders(refs);
    renderSelectedProvider(refs, provider?.id || "");
    renderProviderStatus(refs, editorStatus(provider));
}
// Applies the selected provider template to the editor form.
function applyTemplate(refs) {
    const templates = AppContext.model.appState?.providers?.templates || [];
    const template = templates.find((item) => item.name === refs.providerTemplate.value);
    if (!template) {
        return;
    }
    if (ProviderAccountPanels.isSpecialTemplate(template)) {
        ProviderAccountPanels.applyTemplate(refs, template);
    }
    else if (!refs.providerName.value.trim()) {
        refs.providerName.value = template.name;
    }
    refs.providerApiUrl.value = template.apiUrl;
    ProviderAccountPanels.render(refs);
    applyOpenCodeDefaults(refs, template);
    updateTokenMask(refs);
    updateModelFilter(refs);
    updateCustomHeaders(refs);
}
// Saves the provider editor form.
async function saveProvider(event) {
    event.preventDefault();
    const refs = AppContext.refs;
    const provider = {
        id: refs.providerId.value,
        name: refs.providerName.value,
        apiUrl: refs.providerApiUrl.value,
        apiKey: refs.providerApiKey.value,
        customHeaders: refs.providerCustomHeadersEnabled.checked ? refs.providerCustomHeaders.value : "",
        customHeadersEnabled: refs.providerCustomHeadersEnabled.checked,
        filterModels: refs.providerFilterModels.checked,
        modelFilterRegex: refs.providerModelFilterRegex.value,
        enabled: refs.providerEnabled.checked,
    };
    renderProviderStatus(refs, "Checking provider models...");
    try {
        const snapshot = await Api.saveProvider(provider);
        Renderer.renderState(refs, AppContext.model, snapshot);
        Renderer.renderProviders(refs, snapshot);
        openEditor(refs, AppContext.model, savedProviderId(snapshot, provider));
        renderProviderStatus(refs, snapshot.status);
    }
    catch (error) {
        renderProviderStatus(refs, String(error), true);
    }
}
// Deletes a provider and keeps the manager open on the next available provider.
async function deleteProvider(refs, model, providerId) {
    try {
        const snapshot = await Api.deleteProvider(providerId);
        Renderer.renderState(refs, model, snapshot);
        Renderer.renderProviders(refs, snapshot);
        const nextProviderId = snapshot.providers.activeProviderId || snapshot.providers.providers[0]?.id || "";
        openEditor(refs, model, nextProviderId);
        renderProviderStatus(refs, snapshot.status);
    }
    catch (error) {
        renderProviderStatus(refs, String(error), true);
    }
}
// Applies OpenCode-specific defaults without overwriting user-entered values.
function applyOpenCodeDefaults(refs, template) {
    if (template.name !== "opencodezen") {
        return;
    }
    if (!refs.providerApiKey.value.trim()) {
        refs.providerApiKey.value = "public";
    }
    refs.providerFilterModels.checked = true;
    if (!refs.providerModelFilterRegex.value.trim()) {
        refs.providerModelFilterRegex.value = snapshotDefaultRegex();
    }
}
// Shows the header JSON field only when custom headers are enabled.
function updateCustomHeaders(refs) {
    const enabled = refs.providerCustomHeadersEnabled.checked;
    refs.providerCustomHeadersInputField.hidden = !enabled;
    refs.providerCustomHeaders.disabled = !enabled;
}
// Enables the regex field only when model filtering is active.
function updateModelFilter(refs) {
    const enabled = refs.providerFilterModels.checked;
    refs.providerModelFilterRegexField.hidden = !enabled;
    refs.providerModelFilterRegex.disabled = !enabled;
    if (!refs.providerModelFilterRegex.value.trim()) {
        refs.providerModelFilterRegex.value = snapshotDefaultRegex();
    }
}
// Masks provider tokens except for OpenCode Zen while retaining normal edit and clipboard behavior.
function updateTokenMask(refs) {
    const template = templateByApiUrl(refs.providerApiUrl.value);
    const isOpenCodeZen = refs.providerId.value === "opencode-zen"
        || refs.providerTemplate.value === "opencodezen"
        || template?.name === "opencodezen";
    refs.providerApiKey.type = isOpenCodeZen ? "text" : "password";
}
// Finds the saved provider id after creating or updating provider input.
function savedProviderId(snapshot, input) {
    if (input.id) {
        return input.id;
    }
    return [...snapshot.providers.providers]
        .reverse()
        .find((provider) => provider.name === input.name.trim() && provider.apiUrl === input.apiUrl.trim().replace(/\/+$/, ""))?.id || snapshot.providers.activeProviderId;
}
// Renders provider-manager status text.
function renderProviderStatus(refs, message, isError = false) {
    refs.providerStatusText.textContent = message || "Ready.";
    refs.providerStatusRow.classList.toggle("is-error", isError);
}
// Returns the appropriate editor helper status for a provider.
function editorStatus(provider) {
    if (!provider) {
        return "New provider details.";
    }
    if (provider.error) {
        return provider.error;
    }
    return provider.enabled ? "Edit provider details." : "Provider is disabled until a successful model refresh.";
}
// Serializes provider headers into the editor JSON field.
function headersText(headers) {
    if (!headers?.length) {
        return "";
    }
    const value = {};
    for (const header of headers) {
        value[header.name] = header.value;
    }
    return JSON.stringify(value);
}
// Marks the provider currently loaded in the editor.
function renderSelectedProvider(refs, providerId) {
    refs.providerList.querySelectorAll("[data-provider-id]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.providerId === providerId);
    });
}

function bindTemplateDropdown(refs) {
    SearchableDropdown.bind({
        button: refs.providerTemplateButton,
        panel: refs.providerTemplateDropdown,
        searchInput: refs.providerTemplateSearchInput,
        optionList: refs.providerTemplateOptionList,
        optionSelector: "[data-template-value]",
        valueDatasetKey: "templateValue",
        onOpen: () => renderTemplateOptions(refs),
        onSearch: () => renderTemplateOptions(refs),
        onSelect: (value) => selectTemplateValue(refs, value),
    });
}
function populateTemplateDropdown(refs) {
    if (refs.providerTemplate.options.length > 1) return;
    for (const template of getTemplates()) {
        const option = document.createElement("option");
        option.value = template.name;
        option.textContent = template.name;
        refs.providerTemplate.appendChild(option);
    }
}
function resetTemplateSearch(refs) { refs.providerTemplateSearchInput.value = ""; }
function renderTemplateLabel(refs) {
    refs.providerTemplateButton.textContent = refs.providerTemplate.value || "Custom";
    refs.providerTemplateButton.title = refs.providerTemplate.value || "Custom";
}
function selectTemplateValue(refs, value) {
    refs.providerTemplate.value = value;
    renderTemplateLabel(refs);
    SearchableDropdown.closePanel(refs.providerTemplateButton, refs.providerTemplateDropdown);
    applyTemplate(refs);
}
function renderTemplateOptions(refs) {
    const terms = refs.providerTemplateSearchInput.value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const items = getTemplates();
    const options = [{ name: "", apiUrl: "Custom" }, ...items].filter((t) => {
        const haystack = (t.name || "custom").toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
    refs.providerTemplateOptionList.innerHTML = "";
    for (const template of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ch-model-dropdown__option";
        btn.dataset.templateValue = template.name;
        btn.classList.toggle("is-active", template.name === refs.providerTemplate.value);
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", String(template.name === refs.providerTemplate.value));
        btn.textContent = template.name || "Custom";
        btn.title = template.apiUrl;
        refs.providerTemplateOptionList.appendChild(btn);
    }
}
