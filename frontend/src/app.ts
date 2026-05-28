/** Main browser entry point for the Claude Chat UI. */
/// <reference path="./types.d.ts" />
/// <reference path="./tauri.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./tauri-bridge.ts" />
/// <reference path="./api.ts" />
/// <reference path="./markdown.ts" />
/// <reference path="./render.ts" />
/// <reference path="./app-context.ts" />
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

  // Wires static DOM controls to backend commands and UI helpers.
  function bindEvents(): void {
    refs.btnLogin.addEventListener("click", () => AppContext.renderSnapshot(Api.startLogin));
    refs.btnSignOut.addEventListener("click", () => AppContext.renderSnapshot(Api.signOut));
    refs.btnRefresh.addEventListener("click", refreshCatalog);
    refs.btnDeveloper.addEventListener("click", () => AppContext.safeInvoke(() => Api.openLink("developer")));
    refs.btnSource.addEventListener("click", () => AppContext.safeInvoke(() => Api.openLink("source")));
    refs.modelSelect.addEventListener("change", AppContext.saveSettings);
    refs.toggleThinking.addEventListener("change", AppContext.saveSettings);
    refs.btnNewSession.addEventListener("click", createSessionAndFocus);
    refs.navSessions.addEventListener("click", selectSession);
    refs.btnCompact.addEventListener("click", toggleCompactMode);
    refs.btnAlwaysOnTop.addEventListener("click", toggleAlwaysOnTop);
    refs.btnCopyChat.addEventListener("click", ClipboardActions.copyLastAssistant);
    Renderer.bindScrollTracking(refs, model);
    Composer.bind(refs, model);
    ResizeControls.bind(refs);
  }

  // Applies backend-pushed state and stream events to the visible UI.
  function handleUiEvent(payload: UiEventPayload): void {
    if (payload.type === "snapshot" && payload.snapshot) {
      Renderer.renderState(refs, model, payload.snapshot);
    } else if (payload.type === "assistantDelta") {
      Renderer.renderAssistantMessage(refs, model, payload.sessionId || "", payload.messageId || "", payload.text || "");
    } else if (payload.type === "sessionTitleUpdated") {
      Renderer.renderSessionTitle(refs, model, payload.sessionId || "", payload.title || "");
    } else if (payload.type === "error") {
      Renderer.renderStatus(refs, payload.message || "Error", true);
      Renderer.updateButtons(refs, model);
    }
  }

  // Loads initial state and refreshes models once for signed-in users.
  async function refreshState(): Promise<void> {
    const snapshot = await AppContext.safeInvoke(Api.getSnapshot);
    if (snapshot) {
      Renderer.renderState(refs, model, snapshot);
      if (snapshot.account.loggedIn) {
        void refreshCatalog();
      }
    }
  }

  // Refreshes the Claude model catalog and rerenders the snapshot.
  async function refreshCatalog(): Promise<void> {
    const snapshot = await AppContext.safeInvoke(Api.refreshModels);
    if (snapshot) {
      Renderer.renderState(refs, model, snapshot);
    }
  }

  // Handles session selection and deletion from the sidebar.
  function selectSession(event: MouseEvent): void {
    const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-session-id]");
    const deleteSessionId = deleteButton?.dataset.deleteSessionId;
    if (deleteSessionId) {
      void deleteSession(deleteSessionId);
      return;
    }
    const sessionItem = (event.target as HTMLElement).closest<HTMLElement>("[data-session-id]");
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
    Renderer.setCompactMode(refs, !refs.appShell.classList.contains("is-compact"));
    await AppContext.saveSettings();
  }
}
