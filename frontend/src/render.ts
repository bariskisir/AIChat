/** Rendering helpers for AI Chat. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./message-utils.ts" />
/// <reference path="./markdown.ts" />

namespace Renderer {
  const MIN_SIDEBAR_WIDTH = 80;
  const MAX_SIDEBAR_WIDTH = 360;
  const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;
  const VERBOSITY_LEVELS = [
    { value: "low", label: "low", title: "Shorter, more direct answers" },
    { value: "medium", label: "medium", title: "Balanced answer detail" },
    { value: "high", label: "high", title: "More detailed answers" },
  ];

  export interface UiModel {
    appState: AppSnapshot | null;
    pendingImageDataUrls: string[];
    copyResetTimer: number;
    streamAutoScroll: boolean;
  }

  // Renders a complete backend snapshot into the UI.
  export function renderState(refs: DomRefs.Refs, model: UiModel, state: AppSnapshot): void {
    const previousState = model.appState;
    const preservedScrollTop = refs.chatMessages.scrollTop;
    const sameSession = previousState?.activeSession.id === state.activeSession.id;
    if (!sameSession || (!previousState?.isGenerating && state.isGenerating)) {
      model.streamAutoScroll = true;
    }
    const streamScrollPaused = sameSession && !model.streamAutoScroll && Boolean(previousState?.isGenerating || state.isGenerating);
    model.appState = state;
    populateOptions(refs, state);
    renderStatus(refs, state.status);
    renderSessions(refs, state);
    renderProviders(refs, state);
    renderMessages(refs, state.activeSession, {
      preservedScrollTop,
      scrollToBottom: !streamScrollPaused,
    });
    setCompactMode(refs, state.settings.compactMode);
    setSidebarWidth(refs, state.settings.sidebarWidth);
    renderImagePreview(refs, model);
    updateButtons(refs, model);
  }

  // Tracks whether streaming should keep auto-scrolling.
  export function bindScrollTracking(refs: DomRefs.Refs, model: UiModel): void {
    refs.chatMessages.addEventListener("scroll", () => updateStreamAutoScroll(refs, model), { passive: true });
  }

  // Updates the visible status text.
  export function renderStatus(refs: DomRefs.Refs, message: string, isError = false): void {
    const text = message || "Ready.";
    refs.statusText.textContent = text;
    refs.statusRow.classList.toggle("is-error", isError);
  }

  // Applies a streamed assistant text delta.
  export function renderAssistantMessage(refs: DomRefs.Refs, model: UiModel, sessionId: string, messageId: string, text: string): void {
    const active = model.appState?.activeSession;
    if (!active || active.id !== sessionId) {
      return;
    }
    let message = active.messages.find((item) => item.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: "assistant",
        text: "",
        imageDataUrls: [],
        createdAt: new Date().toISOString(),
      };
      active.messages.push(message);
    }
    message.text += text;
    const node = refs.chatMessages.querySelector<HTMLElement>(`[data-message-id="${cssEscape(messageId)}"] .ch-bubble__text`);
    if (node) {
      renderMessageText(node, message);
    } else {
      renderMessages(refs, active, {
        preservedScrollTop: refs.chatMessages.scrollTop,
        scrollToBottom: model.streamAutoScroll,
      });
    }
    if (model.streamAutoScroll) {
      scrollToBottom(refs.chatMessages);
    }
    renderStatus(refs, "Streaming answer...");
    updateButtons(refs, model);
  }

  // Shows short-lived copy confirmation.
  export function renderCopyFeedback(refs: DomRefs.Refs, model: UiModel): void {
    window.clearTimeout(model.copyResetTimer);
    refs.btnCopyChat.classList.add("is-copied");
    refs.btnCopyChat.textContent = "\u2713";
    model.copyResetTimer = window.setTimeout(() => {
      refs.btnCopyChat.classList.remove("is-copied");
      refs.btnCopyChat.textContent = "\u2398";
      updateButtons(refs, model);
    }, 1000);
  }

  // Updates a session title after background title generation.
  export function renderSessionTitle(refs: DomRefs.Refs, model: UiModel, sessionId: string, title: string): void {
    const state = model.appState;
    if (!state || !sessionId || !title) {
      return;
    }
    for (const session of state.sessions) {
      if (session.id === sessionId) {
        session.title = title;
      }
    }
    if (state.activeSession.id === sessionId) {
      state.activeSession.title = title;
    }
    renderSessions(refs, state);
  }

  // Reads current UI controls into a settings payload.
  export function collectSettings(refs: DomRefs.Refs): FrontendSettings {
    return {
      model: refs.modelSelect.value,
      compactMode: refs.appShell.classList.contains("is-compact"),
      reasoningEffort: refs.reasoningSelect.value,
      thinkingVariant: refs.thinkingSelect.value,
      verbosity: refs.verbositySelect.value,
      extendedThinking: refs.claudeExtendedThinking.checked,
      claudeEffort: refs.claudeEffortSelect.value,
      alwaysOnTop: refs.btnAlwaysOnTop.classList.contains("is-active"),
      windowWidth: Math.round(window.outerWidth || window.innerWidth),
      windowHeight: Math.round(window.outerHeight || window.innerHeight),
      sidebarWidth: currentSidebarWidth(refs),
    };
  }

  // Renders pending pasted-image thumbnails.
  export function renderImagePreview(refs: DomRefs.Refs, model: UiModel): void {
    refs.composerPreview.hidden = model.pendingImageDataUrls.length === 0;
    refs.composerPreview.innerHTML = "";
    model.pendingImageDataUrls.forEach((imageDataUrl, index) => {
      const item = document.createElement("div");
      item.className = "ch-composer__preview-item";

      const image = document.createElement("img");
      image.className = "ch-composer__thumb";
      image.src = imageDataUrl;
      image.alt = "";
      item.appendChild(image);

      const button = document.createElement("button");
      button.className = "ch-btn--icon ch-composer__remove-image";
      button.type = "button";
      button.title = "Remove image";
      button.setAttribute("aria-label", "Remove image");
      button.dataset.imageIndex = String(index);
      button.textContent = "X";
      item.appendChild(button);

      refs.composerPreview.appendChild(item);
    });
  }

  // Applies compact mode CSS and button text.
  export function setCompactMode(refs: DomRefs.Refs, enabled: boolean): void {
    refs.appShell.classList.toggle("is-compact", enabled);
    refs.btnCompact.textContent = enabled ? "Full" : "Compact";
  }

  // Applies the persisted sidebar width.
  export function setSidebarWidth(refs: DomRefs.Refs, width: number): void {
    const sidebar = sidebarElement(refs);
    if (!sidebar) {
      return;
    }
    const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width || 0)));
    sidebar.style.width = `${clamped}px`;
  }

  // Updates control enabled states and active labels.
  export function updateButtons(refs: DomRefs.Refs, model: UiModel): void {
    const state = model.appState;
    const configured = state?.providers.configured ?? false;
    const generating = state?.isGenerating ?? false;
    refs.btnRefresh.disabled = !configured;
    refs.modelDropdownButton.disabled = !configured;
    refs.modelSearchInput.disabled = !configured;
    refs.modelSelect.disabled = !configured;
    refs.reasoningSelect.disabled = !configured;
    refs.thinkingSelect.disabled = !configured;
    refs.verbositySelect.disabled = !configured || !state?.catalog.verbositySupported;
    refs.claudeExtendedThinking.disabled = !configured;
    refs.claudeEffortSelect.disabled = !configured;
    refs.inputComposer.disabled = !configured;
    refs.btnSend.disabled = !configured || generating || (!refs.inputComposer.value.trim() && model.pendingImageDataUrls.length === 0);
    refs.btnSend.classList.toggle("is-stop", generating);
    refs.btnSend.textContent = generating ? "Esc to Stop" : "Send";
    refs.btnSend.title = generating ? "Press Esc to stop" : "Send message";
    refs.btnSend.setAttribute("aria-label", generating ? "Press Esc to stop" : "Send message");
    refs.btnNewSession.disabled = !configured;
    refs.btnCopyChat.disabled = !configured || (state ? !hasCopyableMessages(state.activeSession) : true);
    refs.btnAlwaysOnTop.classList.toggle("is-active", state?.settings.alwaysOnTop ?? false);
    refs.btnAlwaysOnTop.setAttribute("aria-pressed", String(state?.settings.alwaysOnTop ?? false));
  }

  // Renders the provider manager list.
  export function renderProviders(refs: DomRefs.Refs, state: AppSnapshot | null): void {
    refs.providerList.innerHTML = "";
    if (!state) {
      return;
    }
    for (const provider of state.providers.providers) {
      refs.providerList.appendChild(providerItemNode(provider, refs.providerId.value));
    }
  }

  // Renders the sidebar session list.
  function renderSessions(refs: DomRefs.Refs, state: AppSnapshot): void {
    refs.navSessions.innerHTML = "";
    const sessions = [...state.sessions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const session of sessions) {
      refs.navSessions.appendChild(sessionItemNode(session, state));
    }
  }

  // Builds one session row for the sidebar.
  function sessionItemNode(session: ChatSession, state: AppSnapshot): HTMLElement {
    const item = document.createElement("div");
    item.className = "ch-sidebar__item";
    item.dataset.sessionId = session.id;
    item.classList.toggle("is-active", session.id === state.activeSession.id);

    const titleText = session.title || "New chat";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "ch-sidebar__title";
    title.dataset.sessionId = session.id;
    title.textContent = titleText;
    title.title = titleText;
    item.appendChild(title);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ch-btn--delete ch-sidebar__delete";
    deleteButton.dataset.deleteSessionId = session.id;
    deleteButton.title = "Delete chat";
    deleteButton.setAttribute("aria-label", `Delete ${titleText}`);
    deleteButton.disabled = state.sessions.length <= 1 && session.messages.length === 0;
    item.appendChild(deleteButton);

    return item;
  }

  // Builds one provider row for the provider dialog.
  function providerItemNode(provider: ProviderConfig, selectedProviderId: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "ch-sidebar__item";
    item.dataset.providerId = provider.id;
    item.classList.toggle("is-active", provider.id === selectedProviderId);
    item.classList.toggle("is-disabled", !provider.enabled);

    const title = document.createElement("button");
    title.type = "button";
    title.className = "ch-sidebar__title";
    title.dataset.providerId = provider.id;
    title.textContent = provider.name || "Provider";
    title.title = provider.error || provider.apiUrl;
    item.appendChild(title);

    if (!provider.builtIn) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "ch-btn--delete ch-sidebar__delete";
      deleteButton.dataset.deleteProviderId = provider.id;
      deleteButton.title = "Delete provider";
      deleteButton.setAttribute("aria-label", `Delete ${provider.name || "provider"}`);
      item.appendChild(deleteButton);
    }

    return item;
  }

  // Renders all messages in the active session.
  function renderMessages(refs: DomRefs.Refs, session: ChatSession, scrollOptions: MessageScrollOptions): void {
    refs.chatMessages.innerHTML = "";
    if (!session.messages.length) {
      const empty = document.createElement("div");
      empty.className = "ch-chat__empty";
      empty.textContent = "Start a new message.";
      refs.chatMessages.appendChild(empty);
      return;
    }
    for (const message of session.messages) {
      refs.chatMessages.appendChild(messageNode(message));
    }
    if (scrollOptions.scrollToBottom) {
      scrollToBottom(refs.chatMessages);
      return;
    }
    refs.chatMessages.scrollTop = Math.min(scrollOptions.preservedScrollTop, maxScrollTop(refs.chatMessages));
  }

  interface MessageScrollOptions {
    preservedScrollTop: number;
    scrollToBottom: boolean;
  }

  // Builds one chat message bubble.
  function messageNode(message: ChatMessage): HTMLElement {
    const item = document.createElement("article");
    item.className = `ch-bubble ch-bubble--${message.role}`;
    item.dataset.messageId = message.id;
    for (const imageDataUrl of MessageUtils.imageDataUrls(message)) {
      const image = document.createElement("img");
      image.className = "ch-bubble__image";
      image.src = imageDataUrl;
      image.alt = "";
      item.appendChild(image);
    }
    const text = document.createElement("div");
    text.className = "ch-bubble__text";
    renderMessageText(text, message);
    item.appendChild(text);
    return item;
  }

  // Renders message text with markdown only for assistant messages.
  function renderMessageText(container: HTMLElement, message: ChatMessage): void {
    const isPendingAssistant = message.role === "assistant" && !message.text.trim();
    container.classList.toggle("is-pending", isPendingAssistant);
    if (isPendingAssistant) {
      container.classList.remove("ch-md");
      container.textContent = "";
      return;
    }
    if (message.role === "assistant") {
      MarkdownRenderer.renderInto(container, message.text);
      return;
    }
    container.classList.remove("ch-md");
    container.textContent = message.text || "Image";
  }

  // Populates model and thinking controls from the catalog.
  export function populateModelOptions(refs: DomRefs.Refs, state: AppSnapshot | null): void {
    if (!state) {
      replaceSelectOptions(refs.modelSelect, []);
      renderModelDropdownOptions(refs, []);
      refs.modelDropdownButton.textContent = "Select model";
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
    refs.reasoningSelect.value = state.settings.reasoningEffort || "none";
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
    const isCodex = apiUrl === "codex://chatgpt";
    const isClaude = apiUrl === "claude://claude.ai";
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
    replaceSelectOptions(refs.verbositySelect, VERBOSITY_LEVELS);
    refs.verbositySelect.value = visibleVerbosityValue(state.settings.verbosity, selectedModel, state);
  }

  // Chooses a visible Claude effort value from persisted settings.
  function visibleClaudeEffortValue(value: string): string {
    return ["low", "medium", "high"].includes(value) ? value : "high";
  }

  // Reports whether a Claude model should hide effort controls.
  function isClaudeHaikuModel(model: AvailableModel | undefined): boolean {
    const value = `${model?.model || ""} ${model?.displayName || ""}`.toLocaleLowerCase();
    return value.includes("haiku");
  }

  // Chooses a visible Codex verbosity level when persisted settings contain legacy "default".
  function visibleVerbosityValue(value: string, selectedModel: AvailableModel | undefined, state: AppSnapshot): string {
    if (["low", "medium", "high"].includes(value)) {
      return value;
    }
    const fallback = selectedModel?.defaultVerbosity || state.catalog.defaultVerbosity || "medium";
    return ["low", "medium", "high"].includes(fallback) ? fallback : "medium";
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

  // Populates model and reasoning controls from the catalog.
  function populateOptions(refs: DomRefs.Refs, state: AppSnapshot): void {
    populateModelOptions(refs, state);
  }

  // Returns whether the session has transcript content.
  function hasCopyableMessages(session: ChatSession): boolean {
    return MessageUtils.hasCopyableMessages(session);
  }

  // Reads the current sidebar width for persistence.
  function currentSidebarWidth(refs: DomRefs.Refs): number {
    return Math.round(sidebarElement(refs)?.offsetWidth || 115);
  }

  // Resolves the sidebar container from the nav node.
  function sidebarElement(refs: DomRefs.Refs): HTMLElement | null {
    return refs.navSessions.closest<HTMLElement>(".ch-sidebar");
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

  // Renders the custom dropdown option list.
  function renderModelDropdownOptions(refs: DomRefs.Refs, options: Array<{ value: string; label: string; title?: string }>): void {
    refs.modelOptionList.innerHTML = "";
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "ch-model-dropdown__empty";
      empty.textContent = "No models";
      refs.modelOptionList.appendChild(empty);
      return;
    }
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ch-model-dropdown__option";
      button.dataset.modelValue = option.value;
      button.classList.toggle("is-active", option.value === refs.modelSelect.value);
      button.textContent = option.label;
      button.title = option.title || option.label;
      refs.modelOptionList.appendChild(button);
    }
  }

  // Updates the custom dropdown button text from the selected model.
  function renderModelDropdownLabel(refs: DomRefs.Refs, options: Array<{ value: string; label: string }>): void {
    const selected = options.find((option) => option.value === refs.modelSelect.value);
    refs.modelDropdownButton.textContent = selected?.label || "Select model";
    refs.modelDropdownButton.title = selected?.label || "Select model";
  }

  // Updates auto-scroll preference based on current scroll position.
  function updateStreamAutoScroll(refs: DomRefs.Refs, model: UiModel): void {
    if (!model.appState?.isGenerating) {
      if (isNearBottom(refs.chatMessages)) {
        model.streamAutoScroll = true;
      }
      return;
    }
    model.streamAutoScroll = isNearBottom(refs.chatMessages);
  }

  // Scrolls a container to its bottom edge.
  function scrollToBottom(element: HTMLElement): void {
    element.scrollTop = element.scrollHeight;
  }

  // Returns whether a scroll container is near its bottom.
  function isNearBottom(element: HTMLElement): boolean {
    return maxScrollTop(element) - element.scrollTop <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }

  // Computes the maximum scrollTop for a container.
  function maxScrollTop(element: HTMLElement): number {
    return Math.max(0, element.scrollHeight - element.clientHeight);
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
  function cssEscape(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
  }
}
