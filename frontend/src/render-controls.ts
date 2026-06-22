import * as Constants from "./constants.js";
import * as AppContext from "./app-context.js";
import * as MessageUtils from "./message-utils.js";
import { isNearBottom } from "./render-messages.js";
import { populateModelOptions } from "./render-model.js";
import { type Refs } from "./dom.js";
import { type UiModel } from "./render.js";


// Updates the visible status text.
export function renderStatus(refs: Refs, message: string, isError: boolean = false): void {
  const text = message || Constants.STATUS_READY;
  refs.statusText.textContent = text;
  refs.statusRow.classList.toggle(Constants.CSS.IS_ERROR, isError);
}

// Updates control enabled states and active labels.
export function updateButtons(refs: Refs, model: UiModel): void {
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
  refs.btnSend.disabled = !configured || (!generating && !refs.inputComposer.value.trim() && model.pendingImageDataUrls.length === 0);
  refs.btnSend.classList.toggle(Constants.CSS.IS_STOP, generating);
  refs.btnSend.textContent = generating ? Constants.BTN_STOP : Constants.BTN_SEND;
  refs.btnSend.title = generating ? Constants.BTN_STOP_TITLE : Constants.BTN_SEND_TITLE;
  refs.btnSend.setAttribute("aria-label", generating ? Constants.BTN_STOP_TITLE : Constants.BTN_SEND_TITLE);
  refs.btnNewSession.disabled = !configured;
  refs.btnCopyChat.disabled = !configured || (state ? !hasCopyableMessages(state.activeSession) : true);
  refs.btnAlwaysOnTop.classList.toggle(Constants.CSS.IS_ACTIVE, state?.settings.alwaysOnTop ?? false);
  refs.btnAlwaysOnTop.setAttribute("aria-pressed", String(state?.settings.alwaysOnTop ?? false));
}

// Applies compact mode CSS and button text.
export function setCompactMode(refs: Refs, enabled: boolean): void {
  refs.appShell.classList.toggle(Constants.CSS.IS_COMPACT, enabled);
  refs.btnCompact.textContent = enabled ? Constants.BTN_FULL : Constants.BTN_COMPACT;
}

// Applies the persisted sidebar width.
export function setSidebarWidth(refs: Refs, width: number): void {
  const sidebar = sidebarElement(refs);
  if (!sidebar) {
    return;
  }
  const clamped = Math.min(Constants.MAX_SIDEBAR_WIDTH, Math.max(Constants.MIN_SIDEBAR_WIDTH, Math.round(width || 0)));
  sidebar.style.width = `${clamped}px`;
}

// Shows or hides the footer row.
export function applyShowFooter(refs: Refs, show: boolean): void {
  const footer = refs.btnDeveloper.closest<HTMLElement>("." + Constants.CSS.CH_FOOTER);
  if (footer) {
    footer.style.display = show ? "" : "none";
  }
}

// Shows or hides the status/info bar at the top.
export function applyShowInfoBar(refs: Refs, show: boolean): void {
  refs.statusRow.style.display = show ? "" : "none";
  refs.statusRow.classList.toggle(Constants.CSS.IS_HIDDEN, !show);
}

// Renders pending pasted-image thumbnails.
export function renderImagePreview(refs: Refs, model: UiModel): void {
  refs.composerPreview.hidden = model.pendingImageDataUrls.length === 0;
  refs.composerPreview.innerHTML = "";
  model.pendingImageDataUrls.forEach((imageDataUrl, index) => {
    const item = document.createElement("div");
    item.className = Constants.CSS.CH_COMPOSER_PREVIEW_ITEM;

    const image = document.createElement("img");
    image.className = Constants.CSS.CH_COMPOSER_THUMB;
    image.src = imageDataUrl;
    image.alt = "";
    item.appendChild(image);

    const button = document.createElement("button");
    button.className = Constants.CSS.CH_COMPOSER_REMOVE;
    button.type = "button";
    button.title = Constants.IMAGE_REMOVE_LABEL;
    button.setAttribute("aria-label", Constants.IMAGE_REMOVE_LABEL);
    button.dataset.imageIndex = String(index);
    button.textContent = Constants.IMAGE_REMOVE_TEXT;
    item.appendChild(button);

    refs.composerPreview.appendChild(item);
  });
}

// Shows short-lived copy confirmation.
export function renderCopyFeedback(refs: Refs, model: UiModel): void {
  window.clearTimeout(model.copyResetTimer);
  refs.btnCopyChat.classList.add(Constants.CSS.IS_COPIED);
  refs.btnCopyChat.textContent = Constants.COPY_ICON_CHECK;
  model.copyResetTimer = window.setTimeout(() => {
    refs.btnCopyChat.classList.remove(Constants.CSS.IS_COPIED);
    refs.btnCopyChat.textContent = Constants.COPY_ICON_DEFAULT;
    updateButtons(refs, model);
  }, Constants.COPY_FEEDBACK_MS);
}

// Tracks whether streaming should keep auto-scrolling.
export function bindScrollTracking(refs: Refs, model: UiModel): void {
  refs.chatMessages.addEventListener("scroll", () => updateStreamAutoScroll(refs, model), { passive: true });
}

// Reads current UI controls into a settings payload.
export function collectSettings(refs: Refs): FrontendSettings {
  const state = AppContext.model.appState;
  return {
    model: refs.modelSelect.value,
    compactMode: refs.appShell.classList.contains(Constants.CSS.IS_COMPACT),
    reasoningEffort: refs.reasoningSelect.value,
    thinkingVariant: refs.thinkingSelect.value,
    verbosity: refs.verbositySelect.value,
    extendedThinking: refs.claudeExtendedThinking.checked,
    claudeEffort: refs.claudeEffortSelect.value,
    alwaysOnTop: refs.btnAlwaysOnTop.classList.contains(Constants.CSS.IS_ACTIVE),
    windowWidth: Math.round(window.outerWidth || window.innerWidth),
    windowHeight: Math.round(window.outerHeight || window.innerHeight),
    sidebarWidth: currentSidebarWidth(refs),
    showFooter: state?.settings.showFooter ?? true,
    showInfoBar: state?.settings.showInfoBar ?? true,
    titleGenModel: state?.settings.titleGenModel ?? "",
    favoriteModels: state?.settings.favoriteModels ?? [],
  };
}

// Populates model and reasoning controls from the catalog.
export function populateOptions(refs: Refs, state: AppSnapshot): void {
  populateModelOptions(refs, state);
}

// Reads the current sidebar width for persistence.
function currentSidebarWidth(refs: Refs): number {
  return Math.round(sidebarElement(refs)?.offsetWidth || Constants.DEFAULT_SIDEBAR_WIDTH);
}

// Resolves the sidebar container from the nav node.
function sidebarElement(refs: Refs): HTMLElement | null {
  return refs.navSessions.closest<HTMLElement>("." + Constants.CSS.CH_SIDEBAR);
}

// Returns whether the session has transcript content.
function hasCopyableMessages(session: ChatSession): boolean {
  return MessageUtils.hasCopyableMessages(session);
}

// Updates auto-scroll preference based on current scroll position.
function updateStreamAutoScroll(refs: Refs, model: UiModel): void {
  if (!model.appState?.isGenerating) {
    if (isNearBottom(refs.chatMessages)) {
      model.streamAutoScroll = true;
    }
    return;
  }
  model.streamAutoScroll = isNearBottom(refs.chatMessages);
}
