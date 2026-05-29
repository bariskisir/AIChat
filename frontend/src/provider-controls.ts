/** Provider manager and provider template dropdown behavior. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./api.ts" />
/// <reference path="./provider-templates.ts" />
/// <reference path="./render.ts" />
/// <reference path="./app-context.ts" />

namespace ProviderControls {
  // Wires provider manager controls to backend commands.
  export function bind(refs: DomRefs.Refs, model: Renderer.UiModel): void {
    refs.btnProviders.addEventListener("click", () => openManager(refs, model));
    refs.btnAddProvider.addEventListener("click", () => openEditor(refs, model));
    refs.btnCloseProviders.addEventListener("click", () => refs.providerDialog.close());
    refs.btnCancelProvider.addEventListener("click", () => refs.providerEditorDialog.close());
    refs.providerList.addEventListener("click", (event) => handleProviderClick(refs, model, event));
    refs.providerForm.addEventListener("submit", saveProvider);
    refs.providerTemplate.addEventListener("change", () => applyTemplate(refs));
    refs.providerTemplateButton.addEventListener("click", (event) => toggleTemplateDropdown(refs, event));
    refs.providerTemplateSearchInput.addEventListener("input", () => renderTemplateOptions(refs));
    refs.providerTemplateOptionList.addEventListener("click", (event) => selectTemplateOption(refs, event));
    document.addEventListener("click", (event) => closeTemplateDropdownFromOutside(refs, event));
  }

  // Opens the provider manager dialog.
  function openManager(refs: DomRefs.Refs, model: Renderer.UiModel): void {
    Renderer.renderProviders(refs, model.appState);
    refs.providerDialog.showModal();
  }

  // Handles provider selection and deletion.
  function handleProviderClick(refs: DomRefs.Refs, model: Renderer.UiModel, event: MouseEvent): void {
    const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-provider-id]");
    const deleteProviderId = deleteButton?.dataset.deleteProviderId;
    if (deleteProviderId) {
      void AppContext.renderSnapshot(() => Api.deleteProvider(deleteProviderId));
      return;
    }
    const providerItem = (event.target as HTMLElement).closest<HTMLElement>("[data-provider-id]");
    const providerId = providerItem?.dataset.providerId;
    if (providerId) {
      openEditor(refs, model, providerId);
    }
  }

  // Opens the provider editor with blank or existing values.
  function openEditor(refs: DomRefs.Refs, model: Renderer.UiModel, providerId = ""): void {
    const provider = model.appState?.providers.providers.find((item) => item.id === providerId);
    populateTemplates(refs);
    refs.providerEditorTitle.textContent = provider ? "Edit Provider" : "New Provider";
    refs.providerId.value = provider?.id || "";
    refs.providerName.value = provider?.name || "";
    refs.providerApiUrl.value = provider?.apiUrl || "";
    refs.providerApiKey.value = provider?.apiKey || "";
    refs.providerCustomHeaders.value = provider ? headersText(provider.customHeaders) : "";
    refs.providerTemplate.value = ProviderTemplates.byApiUrl(provider?.apiUrl || "")?.name || "";
    refs.providerTemplateSearchInput.value = "";
    renderTemplateLabel(refs);
    refs.providerEditorDialog.showModal();
    refs.providerTemplateButton.focus();
  }

  // Populates the hidden provider template select once.
  function populateTemplates(refs: DomRefs.Refs): void {
    if (refs.providerTemplate.options.length > 1) {
      return;
    }
    for (const template of ProviderTemplates.items) {
      const option = document.createElement("option");
      option.value = template.name;
      option.textContent = template.name;
      refs.providerTemplate.appendChild(option);
    }
  }

  // Opens or closes the searchable provider template dropdown.
  function toggleTemplateDropdown(refs: DomRefs.Refs, event: MouseEvent): void {
    event.stopPropagation();
    const willOpen = refs.providerTemplateDropdown.hidden;
    refs.providerTemplateDropdown.hidden = !willOpen;
    refs.providerTemplateButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      renderTemplateOptions(refs);
      refs.providerTemplateSearchInput.focus();
      refs.providerTemplateSearchInput.select();
    }
  }

  // Closes the provider template dropdown on outside clicks.
  function closeTemplateDropdownFromOutside(refs: DomRefs.Refs, event: MouseEvent): void {
    const target = event.target as Node;
    if (!refs.providerTemplateDropdown.contains(target) && !refs.providerTemplateButton.contains(target)) {
      closeTemplateDropdown(refs);
    }
  }

  // Selects a provider template from the searchable dropdown.
  function selectTemplateOption(refs: DomRefs.Refs, event: MouseEvent): void {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-template-value]");
    const value = option?.dataset.templateValue;
    if (value === undefined) {
      return;
    }
    refs.providerTemplate.value = value;
    renderTemplateLabel(refs);
    closeTemplateDropdown(refs);
    applyTemplate(refs);
  }

  // Renders matching provider templates in the custom dropdown.
  function renderTemplateOptions(refs: DomRefs.Refs): void {
    const terms = searchTerms(refs.providerTemplateSearchInput.value);
    const options = [{ name: "", apiUrl: "Custom" }, ...ProviderTemplates.items].filter((template) => {
      const haystack = `${template.name || "custom"} ${template.apiUrl}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    refs.providerTemplateOptionList.innerHTML = "";
    for (const template of options) {
      refs.providerTemplateOptionList.appendChild(templateOptionNode(refs, template));
    }
  }

  // Builds one provider template option node.
  function templateOptionNode(refs: DomRefs.Refs, template: ProviderTemplates.Template): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ch-model-dropdown__option";
    button.dataset.templateValue = template.name;
    button.classList.toggle("is-active", template.name === refs.providerTemplate.value);
    button.textContent = template.name || "Custom";
    button.title = template.apiUrl;
    return button;
  }

  // Applies the selected provider template to the editor form.
  function applyTemplate(refs: DomRefs.Refs): void {
    const template = ProviderTemplates.items.find((item) => item.name === refs.providerTemplate.value);
    if (!template) {
      return;
    }
    if (!refs.providerName.value.trim()) {
      refs.providerName.value = template.name;
    }
    refs.providerApiUrl.value = template.apiUrl;
    if (template.name === "opencodezen") {
      if (!refs.providerApiKey.value.trim()) {
        refs.providerApiKey.value = "public";
      }
      if (!refs.providerCustomHeaders.value.trim()) {
        refs.providerCustomHeaders.value = JSON.stringify({ "x-opencode-session": "" }, null, 2);
      }
    }
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
    const snapshot = await AppContext.safeInvoke(() => Api.saveProvider(provider));
    if (snapshot) {
      Renderer.renderState(refs, AppContext.model, snapshot);
      Renderer.renderProviders(refs, snapshot);
      refs.providerEditorDialog.close();
    }
  }

  // Updates the provider template button label.
  function renderTemplateLabel(refs: DomRefs.Refs): void {
    refs.providerTemplateButton.textContent = refs.providerTemplate.value || "Custom";
    refs.providerTemplateButton.title = refs.providerTemplate.value || "Custom";
  }

  // Hides the provider template dropdown.
  function closeTemplateDropdown(refs: DomRefs.Refs): void {
    refs.providerTemplateDropdown.hidden = true;
    refs.providerTemplateButton.setAttribute("aria-expanded", "false");
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
    return JSON.stringify(value, null, 2);
  }

  // Splits search text into independent lowercase terms.
  function searchTerms(value: string): string[] {
    return value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  }
}
