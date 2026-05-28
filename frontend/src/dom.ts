/** DOM reference collection for Claude Chat. */

namespace DomRefs {
  export interface Refs {
    appShell: HTMLElement;
    viewSignedOut: HTMLElement;
    viewSignedIn: HTMLElement;
    statusRow: HTMLElement;
    statusText: HTMLElement;
    authStatusText: HTMLElement;
    accountLabel: HTMLElement;
    btnRefresh: HTMLButtonElement;
    btnLogin: HTMLButtonElement;
    btnSignOut: HTMLButtonElement;
    modelSelect: HTMLSelectElement;
    toggleThinking: HTMLInputElement;
    btnNewSession: HTMLButtonElement;
    navSessions: HTMLElement;
    resizerSidebar: HTMLElement;
    btnCompact: HTMLButtonElement;
    btnAlwaysOnTop: HTMLButtonElement;
    chatMessages: HTMLElement;
    resizerComposer: HTMLElement;
    formComposer: HTMLFormElement;
    inputComposer: HTMLTextAreaElement;
    composerPreview: HTMLElement;
    btnSend: HTMLButtonElement;
    btnCopyChat: HTMLButtonElement;
    btnDeveloper: HTMLButtonElement;
    btnSource: HTMLButtonElement;
  }

  // Resolves all static DOM nodes used by the app.
  export function getRefs(): Refs {
    return {
      appShell: get("appShell"),
      viewSignedOut: get("viewSignedOut"),
      viewSignedIn: get("viewSignedIn"),
      statusRow: get("statusRow"),
      statusText: get("statusText"),
      authStatusText: get("authStatusText"),
      accountLabel: get("accountLabel"),
      btnRefresh: get("btnRefresh"),
      btnLogin: get("btnLogin"),
      btnSignOut: get("btnSignOut"),
      modelSelect: get("modelSelect"),
      toggleThinking: get("toggleThinking"),
      btnNewSession: get("btnNewSession"),
      navSessions: get("navSessions"),
      resizerSidebar: get("resizerSidebar"),
      btnCompact: get("btnCompact"),
      btnAlwaysOnTop: get("btnAlwaysOnTop"),
      chatMessages: get("chatMessages"),
      resizerComposer: get("resizerComposer"),
      formComposer: get("formComposer"),
      inputComposer: get("inputComposer"),
      composerPreview: get("composerPreview"),
      btnSend: get("btnSend"),
      btnCopyChat: get("btnCopyChat"),
      btnDeveloper: get("btnDeveloper"),
      btnSource: get("btnSource"),
    };
  }

  // Returns a typed element reference or fails fast during startup.
  function get<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element as T;
  }
}
