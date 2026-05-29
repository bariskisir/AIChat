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
    refs.modelOptionList.addEventListener("click", selectOption);
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
    Renderer.selectModel(AppContext.refs, value);
    close(AppContext.refs);
    await AppContext.saveSettings();
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
