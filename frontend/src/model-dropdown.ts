/** Searchable model dropdown behavior. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./render.ts" />
/// <reference path="./app-context.ts" />
/// <reference path="./searchable-dropdown.ts" />

namespace ModelDropdown {
  // Wires the custom model dropdown to settings persistence.
  export function bind(refs: DomRefs.Refs, model: Renderer.UiModel): void {
    SearchableDropdown.bind({
      button: refs.modelDropdownButton,
      panel: refs.modelDropdown,
      searchInput: refs.modelSearchInput,
      optionList: refs.modelOptionList,
      optionSelector: "[data-model-value]",
      valueDatasetKey: "modelValue",
      onOpen: () => Renderer.populateModelOptions(refs, model.appState),
      onSearch: () => Renderer.populateModelOptions(refs, model.appState),
      onSelect: selectModelValue,
    });
  }

  // Selects a model value and persists it through normal settings.
  async function selectModelValue(value: string): Promise<void> {
    Renderer.selectModel(AppContext.refs, value);
    close(AppContext.refs);
    await AppContext.saveSettings();
  }

  // Hides the custom model dropdown.
  function close(refs: DomRefs.Refs): void {
    SearchableDropdown.closePanel(refs.modelDropdownButton, refs.modelDropdown);
  }
}
