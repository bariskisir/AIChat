/** Settings dialog behavior for AI Chat. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./render.ts" />
/// <reference path="./app-context.ts" />

namespace SettingsControls {
  const TITLE_GEN_NONE = "none";
  const TITLE_GEN_CURRENT = "";

  // Wires all settings dialog controls.
  export function bind(refs: DomRefs.Refs): void {
    refs.btnSettings.addEventListener("click", () => open(refs));
    refs.btnCloseSettings.addEventListener("click", () => refs.settingsDialog.close());
    refs.settingsShowFooter.addEventListener("change", () => applySettings(refs));
    refs.settingsShowInfoBar.addEventListener("change", () => applySettings(refs));
    refs.settingsTitleGenDropdownButton.addEventListener("click", (event) => toggleModelDropdown(refs, event));
    refs.settingsTitleGenSearchInput.addEventListener("input", () => filterTitleGenOptions(refs));
    refs.settingsTitleGenSearchInput.addEventListener("keydown", (event) => handleTitleGenSearchKeydown(refs, event));
    refs.settingsTitleGenOptionList.addEventListener("click", (event) => selectTitleGenOption(refs, event));
    refs.settingsTitleGenOptionList.addEventListener("keydown", (event) => handleTitleGenOptionKeydown(refs, event));
    document.addEventListener("click", (event) => closeTitleGenFromOutside(refs, event));
  }

  // Opens the settings dialog and populates current values.
  function open(refs: DomRefs.Refs): void {
    const state = AppContext.model.appState;
    if (!state) return;
    refs.settingsShowFooter.checked = state.settings.showFooter;
    refs.settingsShowInfoBar.checked = state.settings.showInfoBar;
    populateTitleGenOptions(refs);
    updateTitleGenDropdownLabel(refs);
    refs.settingsTitleGenSelect.value = state.settings.titleGenModel || TITLE_GEN_CURRENT;
    refs.settingsTitleGenDropdown.hidden = true;
    refs.settingsDialog.showModal();
  }

  // Applies current toggle settings and persists.
  async function applySettings(refs: DomRefs.Refs): Promise<void> {
    const state = AppContext.model.appState;
    if (!state) return;
    state.settings.showFooter = refs.settingsShowFooter.checked;
    state.settings.showInfoBar = refs.settingsShowInfoBar.checked;
    Renderer.applyShowFooter(refs, state.settings.showFooter);
    Renderer.applyShowInfoBar(refs, state.settings.showInfoBar);
    await AppContext.saveSettings();
  }

  // Populates the title generation model dropdown options.
  function populateTitleGenOptions(refs: DomRefs.Refs): void {
    const state = AppContext.model.appState;
    refs.settingsTitleGenSelect.innerHTML = "";
    const noneOption = document.createElement("option");
    noneOption.value = TITLE_GEN_NONE;
    noneOption.textContent = "None";
    refs.settingsTitleGenSelect.appendChild(noneOption);
    const currentOption = document.createElement("option");
    currentOption.value = TITLE_GEN_CURRENT;
    currentOption.textContent = "Current";
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
    const value = state?.settings.titleGenModel || TITLE_GEN_CURRENT;
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
    return provider.apiUrl === "codex://chatgpt" || provider.apiUrl === "claude://claude.ai";
  }

  // Filters the title gen dropdown options by search text.
  function filterTitleGenOptions(refs: DomRefs.Refs): void {
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
  function renderTitleGenDropdownOptions(refs: DomRefs.Refs, options: Array<{ value: string; label: string }>): void {
    refs.settingsTitleGenOptionList.innerHTML = "";
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "ch-model-dropdown__empty";
      empty.textContent = "No matches";
      refs.settingsTitleGenOptionList.appendChild(empty);
      return;
    }
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ch-model-dropdown__option";
      button.dataset.titleGenValue = option.value;
      button.classList.toggle("is-active", option.value === refs.settingsTitleGenSelect.value);
      button.textContent = option.label;
      button.title = option.label;
      refs.settingsTitleGenOptionList.appendChild(button);
    }
  }

  // Toggles the title gen dropdown visibility.
  function toggleModelDropdown(refs: DomRefs.Refs, event: Event): void {
    event.stopPropagation();
    if (refs.settingsTitleGenDropdown.hidden) {
      populateTitleGenOptions(refs);
      refs.settingsTitleGenDropdown.hidden = false;
      refs.settingsTitleGenSearchInput.value = "";
      refs.settingsTitleGenSearchInput.focus();
    } else {
      refs.settingsTitleGenDropdown.hidden = true;
    }
  }

  // Selects a title gen option from the dropdown.
  async function selectTitleGenOption(refs: DomRefs.Refs, event: Event): Promise<void> {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-title-gen-value]");
    if (!target || !target.dataset.titleGenValue) return;
    const value = target.dataset.titleGenValue;
    refs.settingsTitleGenSelect.value = value;
    updateTitleGenDropdownLabel(refs);
    refs.settingsTitleGenDropdown.hidden = true;
    const state = AppContext.model.appState;
    if (state) {
      state.settings.titleGenModel = value;
    }
    await AppContext.saveSettings();
  }

  // Updates the title gen dropdown button label.
  function updateTitleGenDropdownLabel(refs: DomRefs.Refs): void {
    const value = refs.settingsTitleGenSelect.value;
    const option = Array.from(refs.settingsTitleGenSelect.options).find((opt) => opt.value === value);
    refs.settingsTitleGenDropdownButton.textContent = option?.textContent || "Current";
    refs.settingsTitleGenDropdownButton.title = option?.textContent || "Current";
  }

  // Handles keyboard navigation in the title gen search input.
  function handleTitleGenSearchKeydown(refs: DomRefs.Refs, event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      const active = refs.settingsTitleGenOptionList.querySelector<HTMLElement>(".ch-model-dropdown__option.is-active")
        || refs.settingsTitleGenOptionList.querySelector<HTMLElement>(".ch-model-dropdown__option");
      if (active && active.dataset.titleGenValue) {
        refs.settingsTitleGenSelect.value = active.dataset.titleGenValue;
        updateTitleGenDropdownLabel(refs);
        refs.settingsTitleGenDropdown.hidden = true;
        const state = AppContext.model.appState;
        if (state) {
          state.settings.titleGenModel = active.dataset.titleGenValue || "";
        }
        void AppContext.saveSettings();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = Array.from(refs.settingsTitleGenOptionList.querySelectorAll<HTMLElement>(".ch-model-dropdown__option"));
      if (!options.length) return;
      const current = refs.settingsTitleGenOptionList.querySelector<HTMLElement>(".ch-model-dropdown__option.is-active");
      const currentIndex = current ? options.indexOf(current) : -1;
      let nextIndex: number;
      if (event.key === "ArrowDown") {
        nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      }
      options.forEach((opt) => opt.classList.remove("is-active"));
      options[nextIndex].classList.add("is-active");
      options[nextIndex].focus();
    }
  }

  // Handles keyboard navigation in the title gen option list.
  function handleTitleGenOptionKeydown(refs: DomRefs.Refs, event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = Array.from(refs.settingsTitleGenOptionList.querySelectorAll<HTMLElement>(".ch-model-dropdown__option"));
      if (!options.length) return;
      const current = document.activeElement as HTMLElement;
      const currentIndex = options.indexOf(current);
      let nextIndex: number;
      if (event.key === "ArrowDown") {
        nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      }
      options[nextIndex].focus();
    }
  }

  // Closes the title gen dropdown when clicking outside.
  function closeTitleGenFromOutside(refs: DomRefs.Refs, event: Event): void {
    const target = event.target as HTMLElement;
    if (!refs.settingsTitleGenDropdown.hidden && !target.closest("#settingsTitleGenDropdown") && !target.closest("#settingsTitleGenDropdownButton")) {
      refs.settingsTitleGenDropdown.hidden = true;
    }
  }
}
