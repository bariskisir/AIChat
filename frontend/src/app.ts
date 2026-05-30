/** Main browser entry point for the AI Chat UI. */
/// <reference path="./constants.ts" />
/// <reference path="./types.d.ts" />
/// <reference path="./tauri.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./tauri-bridge.ts" />
/// <reference path="./api.ts" />
/// <reference path="./provider-templates.ts" />
/// <reference path="./markdown.ts" />
/// <reference path="./render.ts" />
/// <reference path="./render-messages.ts" />
/// <reference path="./render-model.ts" />
/// <reference path="./render-session.ts" />
/// <reference path="./render-providers.ts" />
/// <reference path="./render-controls.ts" />
/// <reference path="./app-context.ts" />
/// <reference path="./searchable-dropdown.ts" />
/// <reference path="./model-dropdown.ts" />
/// <reference path="./provider-template-dropdown.ts" />
/// <reference path="./provider-account-panels.ts" />
/// <reference path="./provider-controls.ts" />
/// <reference path="./settings-controls.ts" />
/// <reference path="./clipboard.ts" />
/// <reference path="./composer.ts" />
/// <reference path="./resize.ts" />

namespace App {
  const refs = AppContext.refs;
  const model = AppContext.model;

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await TauriBridge.listenAppEvents(handleUiEvent);
    await refreshState();
  });

  function bindModelEvents(): void {
    refs.btnRefresh.addEventListener("click", refreshCatalog);
    refs.modelSelect.addEventListener("change", AppContext.saveSettings);
    refs.reasoningSelect.addEventListener("change", AppContext.saveSettings);
    refs.thinkingSelect.addEventListener("change", AppContext.saveSettings);
    refs.verbositySelect.addEventListener("change", AppContext.saveSettings);
    refs.claudeExtendedThinking.addEventListener("change", AppContext.saveSettings);
    refs.claudeEffortSelect.addEventListener("change", AppContext.saveSettings);
    ModelDropdown.bind(refs, model);
  }

  function bindSessionEvents(): void {
    refs.btnNewSession.addEventListener("click", createSessionAndFocus);
    refs.navSessions.addEventListener("click", selectSession);
  }

  function bindWindowEvents(): void {
    refs.btnCompact.addEventListener("click", toggleCompactMode);
    refs.btnAlwaysOnTop.addEventListener("click", toggleAlwaysOnTop);
    refs.btnCopyChat.addEventListener("click", ClipboardActions.copyLastAssistant);
    refs.btnDeveloper.addEventListener("click", () => AppContext.safeInvoke(() => Api.openLink(Constants.LINK_DEVELOPER)));
    refs.btnSource.addEventListener("click", () => AppContext.safeInvoke(() => Api.openLink(Constants.LINK_SOURCE)));
  }

  function bindComposerEvents(): void {
    Composer.bind(refs, model);
  }

  function bindResizeEvents(): void {
    ResizeControls.bind(refs);
  }

  // Wires static DOM controls to backend commands and UI helpers.
  function bindEvents(): void {
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
  function handleUiEvent(payload: UiEventPayload): void {
    if (payload.type === Constants.EVENT_SNAPSHOT && payload.snapshot) {
      Renderer.renderState(refs, model, payload.snapshot);
      ProviderControls.sync(refs);
    } else if (payload.type === Constants.EVENT_ASSISTANT_DELTA) {
      Renderer.renderAssistantMessage(refs, model, payload.sessionId || "", payload.messageId || "", payload.text || "");
    } else if (payload.type === Constants.EVENT_SESSION_TITLE) {
      Renderer.renderSessionTitle(refs, model, payload.sessionId || "", payload.title || "");
    } else if (payload.type === Constants.EVENT_ERROR) {
      Renderer.renderStatus(refs, payload.message || Constants.ERROR_LABEL, true);
      Renderer.updateButtons(refs, model);
    }
  }

  // Loads initial state and refreshes models once for configured providers.
  async function refreshState(): Promise<void> {
    const snapshot = await AppContext.safeInvoke(Api.getSnapshot);
    if (snapshot) {
      Renderer.renderState(refs, model, snapshot);
      if (snapshot.providers.configured) {
        void refreshCatalog();
      }
    }
  }

  // Refreshes the provider model catalog and rerenders the snapshot.
  async function refreshCatalog(): Promise<void> {
    const snapshot = await AppContext.safeInvoke(Api.refreshModels);
    if (snapshot) {
      Renderer.renderState(refs, model, snapshot);
    }
  }

  // Handles session selection and deletion from the sidebar.
  function selectSession(event: MouseEvent): void {
    const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[" + "data-delete-session-id" + "]");
    const deleteSessionId = deleteButton?.dataset.deleteSessionId;
    if (deleteSessionId) {
      void deleteSession(deleteSessionId);
      return;
    }
    const sessionItem = (event.target as HTMLElement).closest<HTMLElement>("[" + "data-session-id" + "]");
    const sessionId = sessionItem?.dataset.sessionId;
    if (sessionId) {
      void AppContext.renderSnapshot(() => Api.selectSession(sessionId));
    }
  }

  // Creates a new session and returns keyboard focus to the composer.
  async function createSessionAndFocus(): Promise<void> {
    await AppContext.renderSnapshot(Api.createSession);
    Composer.focus();
  }

  // Deletes a session and restores composer focus after rerender.
  async function deleteSession(sessionId: string): Promise<void> {
    if (sessionId) {
      await AppContext.renderSnapshot(() => Api.deleteSession(sessionId));
      Composer.focus();
    }
  }

  // Flips the always-on-top setting.
  async function toggleAlwaysOnTop(): Promise<void> {
    const enabled = !model.appState?.settings.alwaysOnTop;
    await AppContext.renderSnapshot(() => Api.setWindowPinned(enabled));
  }

  // Flips compact mode and persists the updated layout.
  async function toggleCompactMode(): Promise<void> {
    Renderer.setCompactMode(refs, !refs.appShell.classList.contains(Constants.CSS.IS_COMPACT));
    await AppContext.saveSettings();
  }
}
