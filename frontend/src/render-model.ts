/// <reference path="./types.d.ts" />
/// <reference path="./constants.ts" />

namespace Renderer {

  // Populates model and thinking controls from the catalog.
  export function populateModelOptions(refs: DomRefs.Refs, state: AppSnapshot | null): void {
    if (!state) {
      replaceSelectOptions(refs.modelSelect, []);
      renderModelDropdownOptions(refs, []);
      refs.modelDropdownButton.textContent = Constants.PLACEHOLDER_SELECT_MODEL;
      return;
    }
    const allOptions = state.catalog.models.filter((item) => !item.hidden).sort(compareModels).map((item) => ({
      value: `${item.providerId}/${item.model}`,
      label: modelLabel(item),
      title: item.description || modelLabel(item),
    }));
    const terms = searchTerms(refs.modelSearchInput.value);
    const filteredOptions = allOptions.filter((item) => modelMatchesSearch(item, terms));
    replaceSelectOptions(refs.modelSelect, allOptions);
    if (state.settings.model && allOptions.some((option) => option.value === state.settings.model)) {
      refs.modelSelect.value = state.settings.model;
    } else if (allOptions.length > 0) {
      refs.modelSelect.value = allOptions[0].value;
      state.settings.model = allOptions[0].value;
    }
    renderModelDropdownOptions(refs, filteredOptions);
    renderModelDropdownLabel(refs, allOptions);
    refs.reasoningSelect.value = state.settings.reasoningEffort || Constants.EFFORT_NONE;
    renderCodexControls(refs, state);
  }

  // Selects a model in the hidden settings select and visible dropdown label.
  export function selectModel(refs: DomRefs.Refs, value: string): void {
    refs.modelSelect.value = value;
    const options = Array.from(refs.modelSelect.options).map((option) => ({
      value: option.value,
      label: option.textContent || option.value,
      title: option.title,
    }));
    renderModelDropdownLabel(refs, options);
    if (AppContext.model.appState) {
      renderCodexControls(refs, AppContext.model.appState);
    }
  }

  // Toggles OpenAI reasoning versus Codex thinking and verbosity controls.
  function renderCodexControls(refs: DomRefs.Refs, state: AppSnapshot): void {
    const apiUrl = selectedProvider(refs, state)?.apiUrl || "";
    const isCodex = apiUrl === Constants.CODEX_API_URL;
    const isClaude = apiUrl === Constants.CLAUDE_API_URL;
    const selectedModel = selectedCatalogModel(refs, state);
    const claudeSupportsEffort = isClaude && !isClaudeHaikuModel(selectedModel);
    refs.reasoningField.hidden = isCodex || isClaude;
    refs.thinkingField.hidden = !isCodex;
    refs.verbosityField.hidden = !isCodex;
    refs.claudeExtendedThinkingField.hidden = !isClaude;
    refs.claudeEffortField.hidden = !claudeSupportsEffort;
    refs.claudeExtendedThinking.checked = state.settings.extendedThinking;
    refs.claudeEffortSelect.value = visibleClaudeEffortValue(state.settings.claudeEffort);
    if (!isCodex) {
      return;
    }
    const thinkingVariants = selectedModel?.thinkingVariants?.length ? selectedModel.thinkingVariants : state.catalog.thinkingVariants;
    replaceSelectOptions(refs.thinkingSelect, thinkingVariants.map((item) => ({
      value: item.value,
      label: item.value,
      title: item.description,
    })));
    refs.thinkingSelect.value = state.settings.thinkingVariant || selectedModel?.defaultThinkingVariant || refs.thinkingSelect.value;
    replaceSelectOptions(refs.verbositySelect, [...Constants.VERBOSITY_OPTIONS]);
    refs.verbositySelect.value = visibleVerbosityValue(state.settings.verbosity, selectedModel, state);
  }

  // Renders the custom dropdown option list.
  function renderModelDropdownOptions(refs: DomRefs.Refs, options: Array<{ value: string; label: string; title?: string }>): void {
    refs.modelOptionList.innerHTML = "";
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = Constants.CSS.CH_MODEL_DROPDOWN_EMPTY;
      empty.textContent = Constants.PLACEHOLDER_NO_MODELS;
      refs.modelOptionList.appendChild(empty);
      return;
    }
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = Constants.CSS.CH_MODEL_DROPDOWN_OPTION;
      button.dataset.modelValue = option.value;
      button.classList.toggle(Constants.CSS.IS_ACTIVE, option.value === refs.modelSelect.value);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === refs.modelSelect.value));
      button.textContent = option.label;
      button.title = option.title || option.label;
      refs.modelOptionList.appendChild(button);
    }
  }

  // Updates the custom dropdown button text from the selected model.
  function renderModelDropdownLabel(refs: DomRefs.Refs, options: Array<{ value: string; label: string }>): void {
    const selected = options.find((option) => option.value === refs.modelSelect.value);
    refs.modelDropdownButton.textContent = selected?.label || Constants.PLACEHOLDER_SELECT_MODEL;
    refs.modelDropdownButton.title = selected?.label || Constants.PLACEHOLDER_SELECT_MODEL;
  }

  // Replaces hidden select options while preserving the previous value when possible.
  function replaceSelectOptions(select: HTMLSelectElement, options: Array<{ value: string; label: string; title?: string }>): void {
    const previous = select.value;
    select.innerHTML = "";
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      element.title = option.title || option.label;
      select.appendChild(element);
    }
    if (options.some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  // Returns the selected model record for model-specific Codex controls.
  function selectedCatalogModel(refs: DomRefs.Refs, state: AppSnapshot): AvailableModel | undefined {
    const [providerId, modelId] = refs.modelSelect.value.split("/");
    return state.catalog.models.find((model) => model.providerId === providerId && model.model === modelId);
  }

  // Returns the selected provider record for the current model key.
  function selectedProvider(refs: DomRefs.Refs, state: AppSnapshot): ProviderConfig | undefined {
    const providerId = refs.modelSelect.value.split("/")[0] || state.providers.activeProviderId;
    return state.providers.providers.find((provider) => provider.id === providerId);
  }

  // Sorts models by version-like numbers and display name.
  function compareModels(leftModel: AvailableModel, rightModel: AvailableModel): number {
    const left = modelSortParts(leftModel.model || leftModel.displayName);
    const right = modelSortParts(rightModel.model || rightModel.displayName);
    for (let index = 0; index < Math.max(left.numbers.length, right.numbers.length); index += 1) {
      const diff = (right.numbers[index] || 0) - (left.numbers[index] || 0);
      if (diff !== 0) {
        return diff;
      }
    }
    if (left.mini !== right.mini) {
      return left.mini ? 1 : -1;
    }
    return (leftModel.displayName || leftModel.model).localeCompare(rightModel.displayName || rightModel.model);
  }

  // Formats a model as provider/model for display.
  function modelLabel(model: AvailableModel): string {
    return `${model.providerName || model.providerId}/${model.model}`;
  }

  // Splits a model search into independent terms.
  function searchTerms(value: string): string[] {
    return value
      .toLocaleLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
  }

  // Returns models matching every typed search term.
  function modelMatchesSearch(option: { label: string; title?: string }, terms: string[]): boolean {
    if (!terms.length) {
      return true;
    }
    const haystack = `${option.label} ${option.title || ""}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  // Extracts sortable numeric parts from a model name.
  function modelSortParts(value: string): { numbers: number[]; mini: boolean } {
    return {
      numbers: (String(value).match(/\d+(?:\.\d+)?/g) || []).map(Number),
      mini: /\bmini\b/i.test(value),
    };
  }

  // Escapes a string for the simple attribute selector used here.
  export function cssEscape(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
  }

  // Chooses a visible Claude effort value from persisted settings.
  function visibleClaudeEffortValue(value: string): string {
    return (Constants.EFFORT_LEVELS as readonly string[]).includes(value) ? value : Constants.EFFORT_DEFAULT;
  }

  // Reports whether a Claude model should hide effort controls.
  function isClaudeHaikuModel(model: AvailableModel | undefined): boolean {
    const value = `${model?.model || ""} ${model?.displayName || ""}`.toLocaleLowerCase();
    return value.includes("haiku");
  }

  // Chooses a visible Codex verbosity level when persisted settings contain legacy "default".
  function visibleVerbosityValue(value: string, selectedModel: AvailableModel | undefined, state: AppSnapshot): string {
    if ((Constants.EFFORT_LEVELS as readonly string[]).includes(value)) {
      return value;
    }
    const fallback = selectedModel?.defaultVerbosity || state.catalog.defaultVerbosity || Constants.VERBOSITY_DEFAULT;
    return (Constants.EFFORT_LEVELS as readonly string[]).includes(fallback) ? fallback : Constants.VERBOSITY_DEFAULT;
  }
}
