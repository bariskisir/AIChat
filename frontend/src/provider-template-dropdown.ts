/** Searchable provider template dropdown behavior. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./provider-templates.ts" />
/// <reference path="./searchable-dropdown.ts" />

namespace ProviderTemplateDropdown {
  // Wires the custom template dropdown and invokes the caller after selection.
  export function bind(refs: DomRefs.Refs, onSelected: () => void): void {
    SearchableDropdown.bind({
      button: refs.providerTemplateButton,
      panel: refs.providerTemplateDropdown,
      searchInput: refs.providerTemplateSearchInput,
      optionList: refs.providerTemplateOptionList,
      optionSelector: "[data-template-value]",
      valueDatasetKey: "templateValue",
      onOpen: () => renderOptions(refs),
      onSearch: () => renderOptions(refs),
      onSelect: (value) => selectValue(refs, value, onSelected),
    });
  }

  // Populates the hidden provider template select once.
  export function populate(refs: DomRefs.Refs): void {
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

  // Clears stale search text between editor openings.
  export function resetSearch(refs: DomRefs.Refs): void {
    refs.providerTemplateSearchInput.value = "";
  }

  // Updates the provider template button label.
  export function renderLabel(refs: DomRefs.Refs): void {
    refs.providerTemplateButton.textContent = refs.providerTemplate.value || "Custom";
    refs.providerTemplateButton.title = refs.providerTemplate.value || "Custom";
  }

  // Hides the provider template dropdown.
  export function close(refs: DomRefs.Refs): void {
    SearchableDropdown.closePanel(refs.providerTemplateButton, refs.providerTemplateDropdown);
  }

  // Applies a selected provider template from click or keyboard.
  function selectValue(refs: DomRefs.Refs, value: string, onSelected: () => void): void {
    refs.providerTemplate.value = value;
    renderLabel(refs);
    close(refs);
    onSelected();
  }

  // Renders matching provider templates in the custom dropdown.
  function renderOptions(refs: DomRefs.Refs): void {
    const terms = searchTerms(refs.providerTemplateSearchInput.value);
    const options = [{ name: "", apiUrl: "Custom" }, ...ProviderTemplates.items].filter((template) => {
      const haystack = (template.name || "custom").toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    refs.providerTemplateOptionList.innerHTML = "";
    for (const template of options) {
      refs.providerTemplateOptionList.appendChild(optionNode(refs, template));
    }
  }

  // Builds one provider template option node.
  function optionNode(refs: DomRefs.Refs, template: ProviderTemplates.Template): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ch-model-dropdown__option";
    button.dataset.templateValue = template.name;
    button.classList.toggle("is-active", template.name === refs.providerTemplate.value);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(template.name === refs.providerTemplate.value));
    button.textContent = template.name || "Custom";
    button.title = template.apiUrl;
    return button;
  }

  // Splits search text into independent lowercase terms.
  function searchTerms(value: string): string[] {
    return value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  }
}
