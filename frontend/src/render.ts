/** Rendering helpers for Claude Chat. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./message-utils.ts" />
/// <reference path="./markdown.ts" />

namespace Renderer {
  const MIN_SIDEBAR_WIDTH = 80;
  const MAX_SIDEBAR_WIDTH = 360;
  const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;

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
    renderAccount(refs, state);
    renderSessions(refs, state);
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
    refs.authStatusText.textContent = text;
    refs.statusRow.classList.toggle("is-error", isError);
    refs.authStatusText.classList.toggle("is-error", isError);
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
      extendedThinking: refs.toggleThinking.checked,
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
    const loggedIn = state?.account.loggedIn ?? false;
    const generating = state?.isGenerating ?? false;
    refs.viewSignedOut.hidden = loggedIn;
    refs.viewSignedIn.hidden = !loggedIn;
    refs.btnLogin.disabled = loggedIn;
    refs.btnSignOut.disabled = !loggedIn;
    refs.btnRefresh.disabled = !loggedIn;
    refs.modelSelect.disabled = !loggedIn;
    refs.inputComposer.disabled = !loggedIn;
    refs.btnSend.disabled = !loggedIn || (!generating && !refs.inputComposer.value.trim() && model.pendingImageDataUrls.length === 0);
    refs.btnSend.classList.toggle("is-stop", generating);
    refs.btnSend.textContent = generating ? "Stop" : "Send";
    refs.btnSend.setAttribute("aria-label", generating ? "Stop response" : "Send message");
    refs.btnNewSession.disabled = !loggedIn;
    refs.btnCopyChat.disabled = !loggedIn || (state ? !hasCopyableMessages(state.activeSession) : true);
    refs.btnAlwaysOnTop.classList.toggle("is-active", state?.settings.alwaysOnTop ?? false);
    refs.btnAlwaysOnTop.setAttribute("aria-pressed", String(state?.settings.alwaysOnTop ?? false));
  }

  // Renders signed-in account identity and plan.
  function renderAccount(refs: DomRefs.Refs, state: AppSnapshot): void {
    if (state.account.loggedIn) {
      const parts = [state.account.email || "Signed in"];
      if (state.account.plan) {
        parts.push(state.account.plan);
      }
      refs.accountLabel.textContent = parts.join(" - ");
    } else {
      refs.accountLabel.textContent = "Not signed in";
    }
    if (!state.account.loggedIn && !state.account.error) {
      refs.authStatusText.textContent = "Connect with Claude to start chatting.";
      refs.authStatusText.classList.remove("is-error");
    }
    if (state.account.error) {
      renderStatus(refs, state.account.error, true);
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
  function populateOptions(refs: DomRefs.Refs, state: AppSnapshot): void {
    const options = state.catalog.models.filter((item) => !item.hidden).sort(compareModels).map((item) => ({
      value: item.model,
      label: item.model,
      title: item.description || item.model,
    }));
    replaceOptions(refs.modelSelect, options);
    if (state.settings.model && options.some((option) => option.value === state.settings.model)) {
      refs.modelSelect.value = state.settings.model;
    } else if (options.length > 0) {
      refs.modelSelect.value = options[0].value;
      state.settings.model = options[0].value;
    }
    refs.toggleThinking.checked = state.settings.extendedThinking;
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

  // Replaces select options while preserving the previous value when possible.
  function replaceOptions(select: HTMLSelectElement, options: Array<{ value: string; label: string; title?: string }>): void {
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
