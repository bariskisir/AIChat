import * as AppContext from "./app-context.js";
import * as Constants from "./constants.js";
// Populates model and thinking controls from the catalog.
export function populateModelOptions(refs, state) {
    if (!state) {
        replaceSelectOptions(refs.modelSelect, []);
        renderModelDropdownOptions(refs, []);
        refs.modelDropdownButton.textContent = Constants.PLACEHOLDER_SELECT_MODEL;
        return;
    }
    const favorites = new Set(state.settings.modelSettings.favoriteModels || []);
    const allOptions = state.catalog.models.filter((item) => !item.hidden).sort((left, right) => {
        const leftFavorite = favorites.has(modelValue(left));
        const rightFavorite = favorites.has(modelValue(right));
        if (leftFavorite !== rightFavorite) {
            return leftFavorite ? -1 : 1;
        }
        return compareModels(left, right);
    }).map((item) => ({
        value: `${item.providerId}/${item.model}`,
        label: modelLabel(item),
        title: item.description || modelLabel(item),
        favorite: favorites.has(modelValue(item)),
    }));
    const terms = searchTerms(refs.modelSearchInput.value);
    const filteredOptions = allOptions.filter((item) => modelMatchesSearch(item, terms));
    replaceSelectOptions(refs.modelSelect, allOptions);
    if (state.settings.model && allOptions.some((option) => option.value === state.settings.model)) {
        refs.modelSelect.value = state.settings.model;
    }
    else if (allOptions.length > 0) {
        refs.modelSelect.value = allOptions[0].value;
        state.settings.model = allOptions[0].value;
    }
    renderModelDropdownOptions(refs, filteredOptions);
    renderModelDropdownLabel(refs, allOptions);
    refs.reasoningSelect.value = state.settings.modelSettings.reasoningEffort || Constants.EFFORT_DEFAULT;
    renderCodexControls(refs, state);
}
// Selects a model in the hidden settings select and visible dropdown label.
export function selectModel(refs, value) {
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
function renderCodexControls(refs, state) {
    const apiUrl = selectedProvider(refs, state)?.apiUrl || "";
    const codex = state.providers.codexUrl;
    const claude = state.providers.claudeUrl;
    const claudeCode = state.providers.claudeCodeUrl;
    const isCodex = apiUrl === codex;
    const isClaude = apiUrl === claude;
    const isClaudeCode = apiUrl === claudeCode;
    const selectedModel = selectedCatalogModel(refs, state);
    const supportsClaudeEffort = (isClaude || isClaudeCode) && claudeSupportsEffort(selectedModel);
    const claudeThinkingNone = isClaude && selectedModel?.claudeThinkingType === "none";
    refs.reasoningField.hidden = isCodex || isClaude || isClaudeCode;
    refs.thinkingField.hidden = !isCodex;
    refs.verbosityField.hidden = !isCodex;
    refs.claudeExtendedThinkingField.hidden = !isClaude || claudeThinkingNone;
    refs.claudeEffortField.hidden = !supportsClaudeEffort;
    refs.claudeExtendedThinking.checked = state.settings.modelSettings.extendedThinking;
    const claudeEffortOptions = selectedModel?.thinkingVariants?.length
        ? selectedModel.thinkingVariants.map((item) => ({
            value: item.value,
            label: item.value === "xhigh" ? "extra" : item.value,
            title: item.description,
        }))
        : [...Constants.CLAUDE_EFFORT_OPTIONS];
    replaceSelectOptions(refs.claudeEffortSelect, claudeEffortOptions);
    refs.claudeEffortSelect.value = visibleClaudeEffortValue(state.settings.modelSettings.claudeEffort, claudeEffortOptions);
    if (!isCodex) {
        return;
    }
    const thinkingVariants = selectedModel?.thinkingVariants?.length ? selectedModel.thinkingVariants : state.catalog.thinkingVariants;
    replaceSelectOptions(refs.thinkingSelect, thinkingVariants.map((item) => ({
        value: item.value,
        label: item.value,
        title: item.description,
    })));
    refs.thinkingSelect.value = state.settings.modelSettings.thinkingVariant || selectedModel?.defaultThinkingVariant || refs.thinkingSelect.value;
    replaceSelectOptions(refs.verbositySelect, [...Constants.VERBOSITY_OPTIONS]);
    refs.verbositySelect.value = visibleVerbosityValue(state.settings.modelSettings.verbosity, selectedModel, state);
}
// Renders the custom dropdown option list.
function renderModelDropdownOptions(refs, options) {
    refs.modelOptionList.innerHTML = "";
    if (!options.length) {
        const empty = document.createElement("div");
        empty.className = Constants.CSS.CH_MODEL_DROPDOWN_EMPTY;
        empty.textContent = Constants.PLACEHOLDER_NO_MODELS;
        refs.modelOptionList.appendChild(empty);
        return;
    }
    for (const option of options) {
        const row = document.createElement("div");
        row.className = Constants.CSS.CH_MODEL_DROPDOWN_OPTION_ROW;
        const button = document.createElement("button");
        button.type = "button";
        button.className = Constants.CSS.CH_MODEL_DROPDOWN_OPTION;
        button.dataset.modelValue = option.value;
        button.classList.toggle(Constants.CSS.IS_ACTIVE, option.value === refs.modelSelect.value);
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(option.value === refs.modelSelect.value));
        button.textContent = option.label;
        button.title = option.title || option.label;
        row.appendChild(button);
        const favoriteButton = document.createElement("button");
        favoriteButton.type = "button";
        favoriteButton.className = Constants.CSS.CH_MODEL_DROPDOWN_FAVORITE;
        favoriteButton.classList.toggle(Constants.CSS.IS_ACTIVE, option.favorite);
        favoriteButton.dataset.favoriteModelValue = option.value;
        favoriteButton.textContent = option.favorite ? Constants.FAVORITE_ICON_ACTIVE : Constants.FAVORITE_ICON_INACTIVE;
        favoriteButton.title = option.favorite ? Constants.FAVORITE_REMOVE_TITLE : Constants.FAVORITE_ADD_TITLE;
        favoriteButton.setAttribute("aria-label", favoriteButton.title);
        favoriteButton.setAttribute("aria-pressed", String(option.favorite));
        row.appendChild(favoriteButton);
        refs.modelOptionList.appendChild(row);
    }
}
// Updates the custom dropdown button text from the selected model.
function renderModelDropdownLabel(refs, options) {
    const selected = options.find((option) => option.value === refs.modelSelect.value);
    refs.modelDropdownButton.textContent = selected?.label || Constants.PLACEHOLDER_SELECT_MODEL;
    refs.modelDropdownButton.title = selected?.label || Constants.PLACEHOLDER_SELECT_MODEL;
}
// Replaces hidden select options while preserving the previous value when possible.
function replaceSelectOptions(select, options) {
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
function selectedCatalogModel(refs, state) {
    const [providerId, modelId] = refs.modelSelect.value.split("/");
    return state.catalog.models.find((model) => model.providerId === providerId && model.model === modelId);
}
// Returns the selected provider record for the current model key.
function selectedProvider(refs, state) {
    const providerId = refs.modelSelect.value.split("/")[0] || state.providers.activeProviderId;
    return state.providers.providers.find((provider) => provider.id === providerId);
}
// Sorts models by version-like numbers and display name.
function compareModels(leftModel, rightModel) {
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
function modelLabel(model) {
    return `${model.providerName || model.providerId}/${model.model}`;
}
// Returns the stable provider/model key used by selection and favorites.
function modelValue(model) {
    return `${model.providerId}/${model.model}`;
}
// Splits a model search into independent terms.
function searchTerms(value) {
    return value
        .toLocaleLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean);
}
// Returns models matching every typed search term.
function modelMatchesSearch(option, terms) {
    if (!terms.length) {
        return true;
    }
    const haystack = `${option.label} ${option.title || ""}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
}
// Extracts sortable numeric parts from a model name.
function modelSortParts(value) {
    return {
        numbers: (String(value).match(/\d+(?:\.\d+)?/g) || []).map(Number),
        mini: /\bmini\b/i.test(value),
    };
}
// Escapes a string for the simple attribute selector used here.
export function cssEscape(value) {
    return value.replace(/["\\]/g, "\\$&");
}
// Chooses a visible Claude effort value from persisted settings.
function visibleClaudeEffortValue(value, options) {
    return options.some((option) => option.value === value)
        ? value
        : options[0]?.value || Constants.CLAUDE_EFFORT_DEFAULT;
}
// Reports whether a Claude model has effort options at all.
function claudeSupportsEffort(model) {
    if (!model?.claudeThinkingType) {
        const value = `${model?.model || ""} ${model?.displayName || ""}`.toLocaleLowerCase();
        return !value.includes("haiku");
    }
    return model.claudeThinkingType === "effort_and_mode";
}
// Chooses a visible Codex verbosity level when persisted settings contain legacy "default".
function visibleVerbosityValue(value, selectedModel, state) {
    if (Constants.EFFORT_LEVELS.includes(value)) {
        return value;
    }
    const fallback = selectedModel?.defaultVerbosity || state.catalog.defaultVerbosity || Constants.VERBOSITY_DEFAULT;
    return Constants.EFFORT_LEVELS.includes(fallback) ? fallback : Constants.VERBOSITY_DEFAULT;
}
