/** Searchable model dropdown behavior. */
import * as AppContext from "./app-context.js";
import * as Renderer from "./render.js";
import * as SearchableDropdown from "./searchable-dropdown.js";
// Wires the custom model dropdown to settings persistence.
export function bind(refs, model) {
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
function toggleFavoriteFromEvent(event) {
    const button = event.target.closest("[data-favorite-model-value]");
    const value = button?.dataset.favoriteModelValue;
    const state = AppContext.model.appState;
    if (!value || !state) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const favorites = new Set(state.settings.modelSettings.favoriteModels || []);
    if (favorites.has(value)) {
        favorites.delete(value);
    }
    else {
        favorites.add(value);
    }
    state.settings.modelSettings.favoriteModels = Array.from(favorites);
    Renderer.populateModelOptions(AppContext.refs, state);
    void AppContext.saveSettings();
}
// Selects a model value and persists it through normal settings.
async function selectModelValue(value) {
    Renderer.selectModel(AppContext.refs, value);
    close(AppContext.refs);
    await AppContext.saveSettings();
}
// Hides the custom model dropdown.
function close(refs) {
    SearchableDropdown.closePanel(refs.modelDropdownButton, refs.modelDropdown);
}
