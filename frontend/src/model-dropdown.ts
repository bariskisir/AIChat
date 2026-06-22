/** Searchable model dropdown behavior. */

import * as AppContext from "./app-context.js";
import { type Refs } from "./dom.js";
import * as Renderer from "./render.js";
import { type UiModel } from "./render.js";
import * as SearchableDropdown from "./searchable-dropdown.js";

// Wires the custom model dropdown to settings persistence.
export function bind(refs: Refs, model: UiModel): void {
  refs.modelOptionList.addEventListener("click", toggleFavoriteFromEvent);
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

// Toggles a model favorite without changing the current model selection.
function toggleFavoriteFromEvent(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-favorite-model-value]");
  const value = button?.dataset.favoriteModelValue;
  const state = AppContext.model.appState;
  if (!value || !state) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const favorites = new Set(state.settings.favoriteModels || []);
  if (favorites.has(value)) {
    favorites.delete(value);
  } else {
    favorites.add(value);
  }
  state.settings.favoriteModels = Array.from(favorites);
  Renderer.populateModelOptions(AppContext.refs, state);
  void AppContext.saveSettings();
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
