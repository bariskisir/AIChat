/** Searchable model dropdown behavior. */

import * as AppContext from "./app-context.js";
import { type Refs } from "./dom.js";
import * as Renderer from "./render.js";
import { type UiModel } from "./render.js";
import * as SearchableDropdown from "./searchable-dropdown.js";

// Wires the custom model dropdown to settings persistence.
export function bind(refs: Refs, model: UiModel): void {
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
function close(refs: Refs): void {
  SearchableDropdown.closePanel(refs.modelDropdownButton, refs.modelDropdown);
}
