/** Typed Tauri command wrappers for ChatGPT Codex. */
/// <reference path="./types.d.ts" />
/// <reference path="./tauri-bridge.ts" />

namespace Api {
  // Loads the current application snapshot.
  export function getSnapshot(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("app_get_snapshot");
  }

  // Persists frontend settings and returns the refreshed snapshot.
  export function updateSettings(settings: FrontendSettings): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("settings_update", { settings });
  }

  // Starts the ChatGPT OAuth sign-in flow.
  export function startLogin(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("auth_start_login");
  }

  // Clears stored ChatGPT authentication.
  export function signOut(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("auth_sign_out");
  }

  // Refreshes the signed-in account model catalog.
  export function refreshModels(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("catalog_refresh_models");
  }

  // Refreshes the signed-in account usage-limit label.
  export function refreshLimits(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("catalog_refresh_limits");
  }

  // Creates a new chat session.
  export function createSession(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("session_create");
  }

  // Selects an existing chat session.
  export function selectSession(sessionId: string): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("session_select", { sessionId });
  }

  // Deletes an existing chat session.
  export function deleteSession(sessionId: string): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("session_delete", { sessionId });
  }

  // Sends a chat message request.
  export function sendChat(input: SendMessageRequest): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("chat_send", { input });
  }

  // Stops the streaming chat response for one chat session.
  export function stopChat(sessionId: string): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("chat_stop", { sessionId });
  }

  // Writes text through the native clipboard command.
  export function writeClipboardText(text: string): Promise<void> {
    return TauriBridge.invokeCommand("clipboard_write_text", { text });
  }

  // Persists and applies the pinned window setting.
  export function setWindowPinned(enabled: boolean): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("window_set_pinned", { enabled });
  }

  // Opens a known external link target.
  export function openLink(target: LinkTarget): Promise<void> {
    return TauriBridge.invokeCommand("link_open", { target });
  }
}
