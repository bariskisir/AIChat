/// <reference path="./types.d.ts" />
/// <reference path="./constants.ts" />

namespace Renderer {
  // Renders the sidebar session list.
  export function renderSessions(refs: DomRefs.Refs, state: AppSnapshot): void {
    refs.navSessions.innerHTML = "";
    const sessions = [...state.sessions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const session of sessions) {
      refs.navSessions.appendChild(sessionItemNode(session, state));
    }
  }

  // Builds one session row for the sidebar.
  function sessionItemNode(session: ChatSession, state: AppSnapshot): HTMLElement {
    const item = document.createElement("div");
    item.className = Constants.CSS.CH_SIDEBAR_ITEM;
    item.dataset.sessionId = session.id;
    item.classList.toggle(Constants.CSS.IS_ACTIVE, session.id === state.activeSession.id);

    const titleText = session.title || Constants.PLACEHOLDER_NEW_CHAT_TITLE;
    const title = document.createElement("button");
    title.type = "button";
    title.className = Constants.CSS.CH_SIDEBAR_TITLE;
    title.dataset.sessionId = session.id;
    title.textContent = titleText;
    title.title = titleText;
    item.appendChild(title);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = Constants.CSS.CH_SIDEBAR_DELETE;
    deleteButton.dataset.deleteSessionId = session.id;
    deleteButton.title = "Delete chat";
    deleteButton.setAttribute("aria-label", `Delete ${titleText}`);
    deleteButton.disabled = state.sessions.length <= 1 && session.messages.length === 0;
    item.appendChild(deleteButton);

    return item;
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
}
