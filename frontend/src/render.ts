/** Rendering helpers for ChatGPT Codex. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./message-utils.ts" />
/// <reference path="./markdown.ts" />

namespace Renderer {
  const MIN_SIDEBAR_WIDTH = 80;
  const MAX_SIDEBAR_WIDTH = 360;

  export interface UiModel {
    appState: AppSnapshot | null;
    pendingImageDataUrls: string[];
    copyResetTimer: number;
  }

  // Renders a full backend state update into the UI.
  export function renderState(refs: DomRefs.Refs, model: UiModel, state: AppSnapshot): void {
    model.appState = state;
    populateOptions(refs, state);
    renderStatus(refs, state.status);
    renderAccount(refs, state);
    renderSessions(refs, state);
    renderMessages(refs, state.activeSession);
    setCompactMode(refs, state.settings.compactMode);
    setSidebarWidth(refs, state.settings.sidebarWidth);
    renderImagePreview(refs, model);
    updateButtons(refs, model);
  }

  // Updates signed-in and signed-out status text.
  export function renderStatus(refs: DomRefs.Refs, message: string, isError = false): void {
    const text = message || "Ready.";
    refs.statusText.textContent = text;
    refs.authStatusText.textContent = text;
    refs.statusRow.classList.toggle("is-error", isError);
    refs.authStatusText.classList.toggle("is-error", isError);
  }

  // Appends a streamed assistant message chunk.
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
      renderMessages(refs, active);
    }
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
    renderStatus(refs, "Streaming answer...");
    updateButtons(refs, model);
  }

  // Shows short-lived copy confirmation on the copy button.
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

  // Applies a generated session title without interrupting message streaming.
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

  // Reads frontend controls into the settings payload.
  export function collectSettings(refs: DomRefs.Refs): FrontendSettings {
    return {
      model: refs.modelSelect.value,
      thinkingVariant: refs.thinkingSelect.value,
      compactMode: refs.appShell.classList.contains("is-compact"),
      alwaysOnTop: refs.btnAlwaysOnTop.classList.contains("is-active"),
      windowWidth: Math.round(window.outerWidth || window.innerWidth),
      windowHeight: Math.round(window.outerHeight || window.innerHeight),
      sidebarWidth: currentSidebarWidth(refs),
    };
  }

  // Shows or clears the pasted image preview.
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

  // Toggles compact UI mode on the app shell.
  export function setCompactMode(refs: DomRefs.Refs, enabled: boolean): void {
    refs.appShell.classList.toggle("is-compact", enabled);
    refs.btnCompact.textContent = enabled ? "Full" : "Compact";
  }

  // Applies the persisted chat navigation sidebar width.
  export function setSidebarWidth(refs: DomRefs.Refs, width: number): void {
    const sidebar = sidebarElement(refs);
    if (!sidebar) {
      return;
    }
    const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width || 0)));
    sidebar.style.width = `${clamped}px`;
  }

  // Synchronizes button and control disabled states with the model.
  export function updateButtons(refs: DomRefs.Refs, model: UiModel): void {
    const state = model.appState;
    if (!state) {
      return;
    }
    const loggedIn = state.account.loggedIn;
    refs.viewSignedOut.hidden = loggedIn;
    refs.viewSignedIn.hidden = !loggedIn;
    refs.btnLogin.disabled = loggedIn;
    refs.btnSignOut.disabled = !loggedIn;
    refs.btnRefresh.disabled = !loggedIn;
    refs.modelSelect.disabled = !loggedIn;
    refs.thinkingSelect.disabled = !loggedIn;
    refs.inputComposer.disabled = !loggedIn;
    refs.btnSend.disabled = !loggedIn || (!state.isGenerating && !refs.inputComposer.value.trim() && model.pendingImageDataUrls.length === 0);
    refs.btnSend.classList.toggle("is-stop", state.isGenerating);
    refs.btnSend.textContent = state.isGenerating ? "Stop" : "Send";
    refs.btnSend.setAttribute("aria-label", state.isGenerating ? "Stop response" : "Send message");
    refs.btnNewSession.disabled = !loggedIn;
    refs.btnCopyChat.disabled = !loggedIn || !hasCopyableMessages(state.activeSession);
    refs.btnAlwaysOnTop.classList.toggle("is-active", state.settings.alwaysOnTop);
    refs.btnAlwaysOnTop.setAttribute("aria-pressed", String(state.settings.alwaysOnTop));
  }

  // Renders sign-in, account, and usage-limit status.
  function renderAccount(refs: DomRefs.Refs, state: AppSnapshot): void {
    refs.accountLabel.textContent = state.account.loggedIn ? state.account.email || "Signed in" : "Not signed in";
    refs.limitText.textContent = state.catalog.limitLabel || "--";
    if (!state.account.loggedIn && !state.account.error) {
      refs.authStatusText.textContent = "Sign in with ChatGPT to use Codex-backed chat models.";
      refs.authStatusText.classList.remove("is-error");
    }
    if (state.account.error) {
      renderStatus(refs, state.account.error, true);
    }
  }

  // Renders the chat session navigation list.
  function renderSessions(refs: DomRefs.Refs, state: AppSnapshot): void {
    refs.navSessions.innerHTML = "";
    const sessions = [...state.sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const session of sessions) {
      refs.navSessions.appendChild(sessionItemNode(session, state));
    }
  }

  // Builds one chat session navigation row.
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
  function renderMessages(refs: DomRefs.Refs, session: ChatSession): void {
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
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
  }

  // Builds one message bubble node.
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

  // Renders message text as Markdown for assistants and plain text for users.
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

  // Rebuilds model and reasoning controls from state.
  function populateOptions(refs: DomRefs.Refs, state: AppSnapshot): void {
    replaceOptions(refs.modelSelect, state.catalog.models.filter((item) => !item.hidden).sort(compareModels).map((item) => ({
      value: item.model,
      label: item.displayName || item.model,
      title: item.description || item.model,
    })));
    refs.modelSelect.value = state.settings.model;
    replaceOptions(refs.thinkingSelect, state.catalog.thinkingVariants.map((item) => ({
      value: item.value,
      label: item.value,
      title: item.description,
    })));
    refs.thinkingSelect.value = state.settings.thinkingVariant;
  }

  // Reports whether the active session has copyable text or image markers.
  function hasCopyableMessages(session: ChatSession): boolean {
    return MessageUtils.hasCopyableMessages(session);
  }

  // Returns the current chat navigation sidebar width.
  function currentSidebarWidth(refs: DomRefs.Refs): number {
    return Math.round(sidebarElement(refs)?.offsetWidth || 115);
  }

  // Finds the chat navigation sidebar container.
  function sidebarElement(refs: DomRefs.Refs): HTMLElement | null {
    return refs.navSessions.closest<HTMLElement>(".ch-sidebar");
  }

  // Replaces a select element's options while preserving selection when possible.
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

  // Sorts model choices with newer and non-mini models first.
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

  // Extracts model-number and mini flags for sorting.
  function modelSortParts(value: string): { numbers: number[]; mini: boolean } {
    return {
      numbers: (String(value).match(/\d+(?:\.\d+)?/g) || []).map(Number),
      mini: /\bmini\b/i.test(value),
    };
  }

  // Escapes a string for use in a CSS selector.
  function cssEscape(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
  }
}
