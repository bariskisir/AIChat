/** Searchable model dropdown behavior. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./render.ts" />
/// <reference path="./app-context.ts" />

namespace ModelDropdown {
  // Wires the custom model dropdown to settings persistence.
  export function bind(refs: DomRefs.Refs, model: Renderer.UiModel): void {
    refs.modelDropdownButton.addEventListener("click", (event) => toggle(refs, model, event));
    refs.modelSearchInput.addEventListener("input", () => Renderer.populateModelOptions(refs, model.appState));
    refs.modelSearchInput.addEventListener("keydown", handleSearchKeydown);
    refs.modelOptionList.addEventListener("click", selectOption);
    refs.modelOptionList.addEventListener("keydown", handleOptionKeydown);
    document.addEventListener("click", (event) => closeFromOutside(refs, event));
  }

  // Opens or closes the searchable model dropdown.
  function toggle(refs: DomRefs.Refs, model: Renderer.UiModel, event: MouseEvent): void {
    event.stopPropagation();
    const willOpen = refs.modelDropdown.hidden;
    refs.modelDropdown.hidden = !willOpen;
    refs.modelDropdownButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      Renderer.populateModelOptions(refs, model.appState);
      refs.modelSearchInput.focus();
      refs.modelSearchInput.select();
    }
  }

  // Selects a model from the custom dropdown and persists settings.
  async function selectOption(event: MouseEvent): Promise<void> {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-model-value]");
    const value = option?.dataset.modelValue;
    if (!value) {
      return;
    }
    await selectModelValue(value);
  }

  // Handles keyboard navigation while focus is in the model search input.
  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusModelOption(event.key === "ArrowDown" ? 0 : modelOptions().length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = activeOrFirstModelOption();
      if (option?.dataset.modelValue) {
        void selectModelValue(option.dataset.modelValue);
      }
    }
  }

  // Handles keyboard navigation once a model result has focus.
  function handleOptionKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const options = modelOptions();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    focusModelOption((current + offset + options.length) % options.length);
  }

  // Selects a model value and persists it through normal settings.
  async function selectModelValue(value: string): Promise<void> {
    Renderer.selectModel(AppContext.refs, value);
    close(AppContext.refs);
    await AppContext.saveSettings();
  }

  // Returns the rendered model result buttons.
  function modelOptions(): HTMLButtonElement[] {
    return Array.from(AppContext.refs.modelOptionList.querySelectorAll<HTMLButtonElement>("[data-model-value]"));
  }

  // Returns the selected visible model option or falls back to the first result.
  function activeOrFirstModelOption(): HTMLButtonElement | null {
    return AppContext.refs.modelOptionList.querySelector<HTMLButtonElement>("[data-model-value].is-active") || modelOptions()[0] || null;
  }

  // Moves keyboard focus to a model option and keeps it visible.
  function focusModelOption(index: number): void {
    const options = modelOptions();
    if (!options.length) {
      return;
    }
    const option = options[Math.max(0, Math.min(index, options.length - 1))];
    option.focus();
    option.scrollIntoView({ block: "nearest" });
  }

  // Closes the model dropdown when another part of the UI is clicked.
  function closeFromOutside(refs: DomRefs.Refs, event: MouseEvent): void {
    const target = event.target as Node;
    if (!refs.modelDropdown.contains(target) && !refs.modelDropdownButton.contains(target)) {
      close(refs);
    }
  }

  // Hides the custom model dropdown.
  function close(refs: DomRefs.Refs): void {
    refs.modelDropdown.hidden = true;
    refs.modelDropdownButton.setAttribute("aria-expanded", "false");
  }
}
