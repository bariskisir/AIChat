/** Searchable provider template dropdown behavior. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./provider-templates.ts" />
/// <reference path="./app-context.ts" />

namespace ProviderTemplateDropdown {
  // Wires the custom template dropdown and invokes the caller after selection.
  export function bind(refs: DomRefs.Refs, onSelected: () => void): void {
    refs.providerTemplateButton.addEventListener("click", (event) => toggle(refs, event));
    refs.providerTemplateSearchInput.addEventListener("input", () => renderOptions(refs));
    refs.providerTemplateSearchInput.addEventListener("keydown", (event) => handleSearchKeydown(refs, event, onSelected));
    refs.providerTemplateOptionList.addEventListener("click", (event) => selectOption(refs, event, onSelected));
    refs.providerTemplateOptionList.addEventListener("keydown", (event) => handleOptionKeydown(event));
    document.addEventListener("click", (event) => closeFromOutside(refs, event));
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
    refs.providerTemplateDropdown.hidden = true;
    refs.providerTemplateButton.setAttribute("aria-expanded", "false");
  }

  // Opens or closes the searchable provider template dropdown.
  function toggle(refs: DomRefs.Refs, event: MouseEvent): void {
    event.stopPropagation();
    const willOpen = refs.providerTemplateDropdown.hidden;
    refs.providerTemplateDropdown.hidden = !willOpen;
    refs.providerTemplateButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      renderOptions(refs);
      refs.providerTemplateSearchInput.focus();
      refs.providerTemplateSearchInput.select();
    }
  }

  // Closes the provider template dropdown on outside clicks.
  function closeFromOutside(refs: DomRefs.Refs, event: MouseEvent): void {
    const target = event.target as Node;
    if (!refs.providerTemplateDropdown.contains(target) && !refs.providerTemplateButton.contains(target)) {
      close(refs);
    }
  }

  // Selects a provider template from the searchable dropdown.
  function selectOption(refs: DomRefs.Refs, event: MouseEvent, onSelected: () => void): void {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-template-value]");
    const value = option?.dataset.templateValue;
    if (value === undefined) {
      return;
    }
    selectValue(refs, value, onSelected);
  }

  // Handles keyboard navigation while focus is in the provider search input.
  function handleSearchKeydown(refs: DomRefs.Refs, event: KeyboardEvent, onSelected: () => void): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(refs, event.key === "ArrowDown" ? 0 : templateOptions(refs).length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = activeOrFirstOption(refs);
      if (option?.dataset.templateValue !== undefined) {
        selectValue(refs, option.dataset.templateValue, onSelected);
      }
    }
  }

  // Handles keyboard navigation once a provider result has focus.
  function handleOptionKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const refs = AppContext.refs;
    const options = templateOptions(refs);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    focusOption(refs, (current + offset + options.length) % options.length);
  }

  // Applies a selected provider template from click or keyboard.
  function selectValue(refs: DomRefs.Refs, value: string, onSelected: () => void): void {
    refs.providerTemplate.value = value;
    renderLabel(refs);
    close(refs);
    onSelected();
  }

  // Returns the rendered provider template result buttons.
  function templateOptions(refs: DomRefs.Refs): HTMLButtonElement[] {
    return Array.from(refs.providerTemplateOptionList.querySelectorAll<HTMLButtonElement>("[data-template-value]"));
  }

  // Returns the selected visible provider option or falls back to the first result.
  function activeOrFirstOption(refs: DomRefs.Refs): HTMLButtonElement | null {
    return refs.providerTemplateOptionList.querySelector<HTMLButtonElement>("[data-template-value].is-active") || templateOptions(refs)[0] || null;
  }

  // Moves keyboard focus to a provider option and keeps it visible.
  function focusOption(refs: DomRefs.Refs, index: number): void {
    const options = templateOptions(refs);
    if (!options.length) {
      return;
    }
    const option = options[Math.max(0, Math.min(index, options.length - 1))];
    option.focus();
    option.scrollIntoView({ block: "nearest" });
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
    button.textContent = template.name || "Custom";
    button.title = template.apiUrl;
    return button;
  }

  // Splits search text into independent lowercase terms.
  function searchTerms(value: string): string[] {
    return value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  }
}
