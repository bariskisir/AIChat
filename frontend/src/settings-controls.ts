/** Settings dialog behavior for AI Chat. */

import * as AppContext from "./app-context.js";
import * as Constants from "./constants.js";
import { type Refs } from "./dom.js";
import * as Renderer from "./render.js";
import * as SearchableDropdown from "./searchable-dropdown.js";

// Wires all settings dialog controls.
export function bind(refs: Refs): void {
  refs.btnSettings.addEventListener("click", () => open(refs));
  refs.btnCloseSettings.addEventListener("click", () => refs.settingsDialog.close());
  refs.settingsShowFooter.addEventListener("change", () => applySettings(refs));
  refs.settingsShowInfoBar.addEventListener("change", () => applySettings(refs));
  SearchableDropdown.bind({
    button: refs.settingsTitleGenDropdownButton,
    panel: refs.settingsTitleGenDropdown,
    searchInput: refs.settingsTitleGenSearchInput,
    optionList: refs.settingsTitleGenOptionList,
    optionSelector: "[data-title-gen-value]",
    valueDatasetKey: "titleGenValue",
    onOpen: () => {
      refs.settingsTitleGenSearchInput.value = "";
      populateTitleGenOptions(refs);
    },
    onSearch: () => filterTitleGenOptions(refs),
    onSelect: (value) => selectTitleGenValue(refs, value),
  });
}

// Opens the settings dialog and populates current values.
function open(refs: Refs): void {
  const state = AppContext.model.appState;
  if (!state) return;
  refs.settingsShowFooter.checked = state.settings.showFooter;
  refs.settingsShowInfoBar.checked = state.settings.showInfoBar;
  populateTitleGenOptions(refs);
  refs.settingsTitleGenSelect.value = state.settings.titleGenModel || Constants.TITLE_GEN_CURRENT;
  updateTitleGenDropdownLabel(refs);
  refs.settingsTitleGenDropdown.hidden = true;
  refs.settingsDialog.showModal();
}

// Applies current toggle settings and persists.
async function applySettings(refs: Refs): Promise<void> {
  const state = AppContext.model.appState;
  if (!state) return;
  state.settings.showFooter = refs.settingsShowFooter.checked;
  state.settings.showInfoBar = refs.settingsShowInfoBar.checked;
  Renderer.applyShowFooter(refs, state.settings.showFooter);
  Renderer.applyShowInfoBar(refs, state.settings.showInfoBar);
  await AppContext.saveSettings();
}

// Populates the title generation model dropdown options.
function populateTitleGenOptions(refs: Refs): void {
  const state = AppContext.model.appState;
  refs.settingsTitleGenSelect.innerHTML = "";
  const noneOption = document.createElement("option");
  noneOption.value = Constants.TITLE_GEN_NONE;
  noneOption.textContent = Constants.LABEL_NONE_TITLE_CASE;
  refs.settingsTitleGenSelect.appendChild(noneOption);
  const currentOption = document.createElement("option");
  currentOption.value = Constants.TITLE_GEN_CURRENT;
  currentOption.textContent = Constants.LABEL_CURRENT;
  refs.settingsTitleGenSelect.appendChild(currentOption);
  if (state) {
    const models = state.catalog.models.filter((m) => !m.hidden && !isReasoningModel(m) && !isCodexOrClaudeModel(m, state));
    for (const model of models) {
      const option = document.createElement("option");
      option.value = `${model.providerId}/${model.model}`;
      option.textContent = `${model.providerName || model.providerId}/${model.model}`;
      refs.settingsTitleGenSelect.appendChild(option);
    }
  }
  const value = state?.settings.titleGenModel || Constants.TITLE_GEN_CURRENT;
  refs.settingsTitleGenSelect.value = value;
  filterTitleGenOptions(refs);
}

// Filters out reasoning-focused models from title generation options.
function isReasoningModel(model: AvailableModel): boolean {
  const id = model.model.toLocaleLowerCase();
  return /^(o1|o3|o4)(-|$)/.test(id);
}

// Filters out Codex and Claude models from title generation options.
function isCodexOrClaudeModel(model: AvailableModel, state: AppSnapshot): boolean {
  const provider = state.providers.providers.find((p) => p.id === model.providerId);
  if (!provider) return false;
  return provider.apiUrl === Constants.CODEX_API_URL || provider.apiUrl === Constants.CLAUDE_API_URL;
}

// Filters the title gen dropdown options by search text.
function filterTitleGenOptions(refs: Refs): void {
  const terms = refs.settingsTitleGenSearchInput.value.toLocaleLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const allOptions = Array.from(refs.settingsTitleGenSelect.options).map((opt) => ({
    value: opt.value,
    label: opt.textContent || opt.value,
  }));
  const filtered = allOptions.filter((opt) => {
    if (!terms.length) return true;
    const haystack = `${opt.label}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  renderTitleGenDropdownOptions(refs, filtered);
}

// Renders the filtered title gen dropdown option list.
function renderTitleGenDropdownOptions(refs: Refs, options: Array<{ value: string; label: string }>): void {
  refs.settingsTitleGenOptionList.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "ch-model-dropdown__empty";
    empty.textContent = Constants.LABEL_NO_MATCHES;
    refs.settingsTitleGenOptionList.appendChild(empty);
    return;
  }
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ch-model-dropdown__option";
    button.dataset.titleGenValue = option.value;
    button.classList.toggle("is-active", option.value === refs.settingsTitleGenSelect.value);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.value === refs.settingsTitleGenSelect.value));
    button.textContent = option.label;
    button.title = option.label;
    refs.settingsTitleGenOptionList.appendChild(button);
  }
}

// Selects a title-generation model value and persists settings.
async function selectTitleGenValue(refs: Refs, value: string): Promise<void> {
  refs.settingsTitleGenSelect.value = value;
  updateTitleGenDropdownLabel(refs);
  SearchableDropdown.closePanel(refs.settingsTitleGenDropdownButton, refs.settingsTitleGenDropdown);
  const state = AppContext.model.appState;
  if (state) {
    state.settings.titleGenModel = value;
  }
  await AppContext.saveSettings();
}

// Updates the title gen dropdown button label.
function updateTitleGenDropdownLabel(refs: Refs): void {
  const value = refs.settingsTitleGenSelect.value;
  const option = Array.from(refs.settingsTitleGenSelect.options).find((opt) => opt.value === value);
  refs.settingsTitleGenDropdownButton.textContent = option?.textContent || Constants.LABEL_CURRENT;
  refs.settingsTitleGenDropdownButton.title = option?.textContent || Constants.LABEL_CURRENT;
}
