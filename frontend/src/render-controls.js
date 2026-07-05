import * as Constants from "./constants.js";
import * as AppContext from "./app-context.js";
import * as MessageUtils from "./message-utils.js";
import { isNearBottom } from "./render-messages.js";
import { populateModelOptions } from "./render-model.js";
// Updates the visible status text.
export function renderStatus(refs, message, isError = false) {
    const text = message || Constants.STATUS_READY;
    refs.statusText.textContent = text;
    refs.statusRow.classList.toggle(Constants.CSS.IS_ERROR, isError);
}
// Updates control enabled states and active labels.
export function updateButtons(refs, model) {
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
    refs.btnCopyRaw.disabled = !configured || (state ? !MessageUtils.lastAssistantText(state.activeSession) : true);
}
// Applies the persisted sidebar width.
export function setSidebarWidth(refs, width) {
    const sidebar = sidebarElement(refs);
    if (!sidebar) {
        return;
    }
    const clamped = Math.min(Constants.MAX_SIDEBAR_WIDTH, Math.max(Constants.MIN_SIDEBAR_WIDTH, Math.round(width || 0)));
    sidebar.style.width = `${clamped}px`;
}
// Shows or hides the status/info bar at the top.
export function applyShowInfoBar(refs, show) {
    refs.statusRow.style.display = show ? "" : "none";
    refs.statusRow.classList.toggle(Constants.CSS.IS_HIDDEN, !show);
}
// Shows or hides the model toolbar.
export function applyShowModelBar(refs, show) {
    refs.modelToolbar.style.display = show ? "" : "none";
}
// Renders pending pasted-image thumbnails.
export function renderImagePreview(refs, model) {
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
export function renderCopyFeedback(refs, model, button) {
    window.clearTimeout(model.copyResetTimer);
    button = button || refs.btnCopyChat;
    const originalText = button.textContent;
    button.classList.add(Constants.CSS.IS_COPIED);
    button.textContent = Constants.COPY_ICON_CHECK;
    model.copyResetTimer = window.setTimeout(() => {
        button.classList.remove(Constants.CSS.IS_COPIED);
        button.textContent = originalText;
        updateButtons(refs, model);
    }, Constants.COPY_FEEDBACK_MS);
}
// Tracks whether streaming should keep auto-scrolling.
export function bindScrollTracking(refs, model) {
    refs.chatMessages.addEventListener("scroll", () => updateStreamAutoScroll(refs, model), { passive: true });
}
// Reads current UI controls into a settings payload.
export function collectSettings(refs) {
    const state = AppContext.model.appState;
    return {
        model: refs.modelSelect.value,
        reasoningEffort: refs.reasoningSelect.value,
        thinkingVariant: refs.thinkingSelect.value,
        verbosity: refs.verbositySelect.value,
        extendedThinking: refs.claudeExtendedThinking.checked,
        claudeEffort: refs.claudeEffortSelect.value,
        sidebarWidth: currentSidebarWidth(refs),
    showInfoBar: state?.settings.visual.showInfoBar ?? true,
        showModelBar: state?.settings.visual.showModelBar ?? true,
        markdownEnabled: AppContext.model.markdownEnabled,
        titleGenModel: state?.settings.modelSettings.titleGenModel ?? "",
        favoriteModels: state?.settings.modelSettings.favoriteModels ?? [],
        checkOnStartup: state?.settings.updates.checkOnStartup ?? true,
    };
}
// Populates model and reasoning controls from the catalog.
export function populateOptions(refs, state) {
    populateModelOptions(refs, state);
}
// Reads the current sidebar width for persistence.
function currentSidebarWidth(refs) {
    return Math.round(sidebarElement(refs)?.offsetWidth || Constants.DEFAULT_SIDEBAR_WIDTH);
}
// Resolves the sidebar container from the nav node.
function sidebarElement(refs) {
    return refs.navSessions.closest("." + Constants.CSS.CH_SIDEBAR);
}
// Returns whether the session has transcript content.
function hasCopyableMessages(session) {
    return MessageUtils.hasCopyableMessages(session);
}
// Updates auto-scroll preference based on current scroll position.
function updateStreamAutoScroll(refs, model) {
    if (!model.appState?.isGenerating) {
        if (isNearBottom(refs.chatMessages)) {
            model.streamAutoScroll = true;
        }
        return;
    }
    model.streamAutoScroll = isNearBottom(refs.chatMessages);
}
