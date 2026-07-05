/** Main browser entry point for the AI Chat UI. */
import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import * as ClipboardActions from "./clipboard.js";
import * as Composer from "./composer.js";
import * as Constants from "./constants.js";
import * as ModelDropdown from "./model-dropdown.js";
import * as ProviderControls from "./provider-controls.js";
import * as Renderer from "./render.js";
import * as ResizeControls from "./resize.js";
import * as SettingsControls from "./settings-controls.js";
import * as TauriBridge from "./tauri-bridge.js";
const refs = AppContext.refs;
const model = AppContext.model;
let sessionShortcutInFlight = false;
document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await TauriBridge.listenAppEvents(handleUiEvent);
    await refreshState();
});
function bindModelEvents() {
    refs.btnRefresh.addEventListener("click", refreshCatalog);
    refs.modelSelect.addEventListener("change", AppContext.saveSettings);
    refs.reasoningSelect.addEventListener("change", AppContext.saveSettings);
    refs.thinkingSelect.addEventListener("change", AppContext.saveSettings);
    refs.verbositySelect.addEventListener("change", AppContext.saveSettings);
    refs.claudeExtendedThinking.addEventListener("change", AppContext.saveSettings);
    refs.claudeEffortSelect.addEventListener("change", AppContext.saveSettings);
    ModelDropdown.bind(refs, model);
}
function bindSessionEvents() {
    refs.btnNewSession.addEventListener("click", createSessionAndFocus);
    refs.navSessions.addEventListener("click", selectSession);
    document.addEventListener("keydown", handleSessionShortcut, true);
}
function bindWindowEvents() {
    refs.btnCopyChat.addEventListener("click", ClipboardActions.copyLastAssistant);
    refs.btnCopyRaw.addEventListener("click", ClipboardActions.copyLastAssistantRaw);
    refs.toggleMarkdown.addEventListener("change", () => {
        model.markdownEnabled = refs.toggleMarkdown.checked;
        AppContext.saveSettings();
        Renderer.renderMessages(refs, model.appState.activeSession, { scrollToBottom: true });
    });
}
function bindComposerEvents() {
    Composer.bind(refs, model);
}
function bindResizeEvents() {
    ResizeControls.bind(refs);
}
// Wires static DOM controls to backend commands and UI helpers.
function bindEvents() {
    bindModelEvents();
    bindSessionEvents();
    bindWindowEvents();
    bindComposerEvents();
    bindResizeEvents();
    Renderer.bindScrollTracking(refs, model);
    ProviderControls.bind(refs, model);
    SettingsControls.bind(refs);
}
// Applies backend-pushed state and stream events to the visible UI.
function handleUiEvent(payload) {
    if (payload.type === Constants.EVENT_SNAPSHOT && payload.snapshot) {
        Renderer.renderState(refs, model, payload.snapshot);
        ProviderControls.sync(refs);
    }
    else if (payload.type === Constants.EVENT_ASSISTANT_DELTA) {
        Renderer.renderAssistantMessage(refs, model, payload.sessionId || "", payload.messageId || "", payload.text || "");
    }
    else if (payload.type === Constants.EVENT_SESSION_TITLE) {
        Renderer.renderSessionTitle(refs, model, payload.sessionId || "", payload.title || "");
    }
    else if (payload.type === Constants.EVENT_ERROR) {
        Renderer.renderStatus(refs, payload.message || Constants.ERROR_LABEL, true);
        Renderer.updateButtons(refs, model);
    }
}
// Loads initial state and refreshes models once for configured providers.
async function refreshState() {
    const snapshot = await AppContext.safeInvoke(Api.getSnapshot);
    if (snapshot) {
        Renderer.renderState(refs, model, snapshot);
        if (snapshot.providers.configured) {
            void refreshCatalog();
        }
    }
}
// Refreshes the provider model catalog and rerenders the snapshot.
async function refreshCatalog() {
    const snapshot = await AppContext.safeInvoke(Api.refreshModels);
    if (snapshot) {
        Renderer.renderState(refs, model, snapshot);
    }
}
// Handles session selection and deletion from the sidebar.
function selectSession(event) {
    const deleteButton = event.target.closest("[" + "data-delete-session-id" + "]");
    const deleteSessionId = deleteButton?.dataset.deleteSessionId;
    if (deleteSessionId) {
        void deleteSession(deleteSessionId);
        return;
    }
    const sessionItem = event.target.closest("[" + "data-session-id" + "]");
    const sessionId = sessionItem?.dataset.sessionId;
    if (sessionId) {
        void AppContext.renderSnapshot(() => Api.selectSession(sessionId));
    }
}
// Cycles through chats with Ctrl+Tab and Ctrl+Shift+Tab.
function handleSessionShortcut(event) {
    if (!event.ctrlKey || event.key !== Constants.KEY.TAB || event.altKey || event.metaKey) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (sessionShortcutInFlight) {
        return;
    }
    const state = model.appState;
    if (!state || state.sessions.length <= 1) {
        return;
    }
    const sessions = sortedSessions(state.sessions);
    const activeIndex = sessions.findIndex((session) => session.id === state.activeSession.id);
    if (activeIndex < 0) {
        return;
    }
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (activeIndex + direction + sessions.length) % sessions.length;
    void selectSessionById(sessions[nextIndex].id);
}
// Selects a session from a keyboard shortcut and restores composer focus.
async function selectSessionById(sessionId) {
    sessionShortcutInFlight = true;
    try {
        await AppContext.renderSnapshot(() => Api.selectSession(sessionId));
        Composer.focus();
    }
    finally {
        sessionShortcutInFlight = false;
    }
}
// Matches the visible sidebar order.
function sortedSessions(sessions) {
    return [...sessions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
// Creates a new session and returns keyboard focus to the composer.
async function createSessionAndFocus() {
    await AppContext.renderSnapshot(Api.createSession);
    Composer.focus();
}
// Deletes a session and restores composer focus after rerender.
async function deleteSession(sessionId) {
    if (sessionId) {
        await AppContext.renderSnapshot(() => Api.deleteSession(sessionId));
        Composer.focus();
    }
}
