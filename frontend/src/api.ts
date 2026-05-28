/** Typed Tauri command wrappers for Claude Chat. */
/// <reference path="./types.d.ts" />
/// <reference path="./tauri-bridge.ts" />

namespace Api {
  // Loads the current backend state snapshot.
  export function getSnapshot(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("app_get_snapshot");
  }

  // Persists frontend-controlled settings.
  export function updateSettings(settings: FrontendSettings): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("settings_update", { settings });
  }

  // Starts the browser-based Claude login flow.
  export function startLogin(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("auth_start_login");
  }

  // Clears the stored Claude account session.
  export function signOut(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("auth_sign_out");
  }

  // Refreshes the Claude model catalog from the backend.
  export function refreshModels(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("catalog_refresh_models");
  }

  // Refreshes account limit metadata when available.
  export function refreshLimits(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("catalog_refresh_limits");
  }

  // Creates and selects a new local chat session.
  export function createSession(): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("session_create");
  }

  // Selects an existing local chat session.
  export function selectSession(sessionId: string): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("session_select", { sessionId });
  }

  // Deletes a local chat session.
  export function deleteSession(sessionId: string): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("session_delete", { sessionId });
  }

  // Sends a user message to Claude.
  export function sendChat(input: SendMessageRequest): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("chat_send", { input });
  }

  // Stops the active Claude response stream.
  export function stopChat(sessionId: string): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("chat_stop", { sessionId });
  }

  // Writes plain text to the system clipboard.
  export function writeClipboardText(text: string): Promise<void> {
    return TauriBridge.invokeCommand("clipboard_write_text", { text });
  }

  // Toggles the native always-on-top window flag.
  export function setWindowPinned(enabled: boolean): Promise<AppSnapshot> {
    return TauriBridge.invokeCommand<AppSnapshot>("window_set_pinned", { enabled });
  }

  // Opens a known external project link.
  export function openLink(target: LinkTarget): Promise<void> {
    return TauriBridge.invokeCommand("link_open", { target });
  }
}
