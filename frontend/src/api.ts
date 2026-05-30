/** Typed Tauri command wrappers for AI Chat. */

import * as TauriBridge from "./tauri-bridge.js";

// Loads the current backend state snapshot.
export function getSnapshot(): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("app_get_snapshot");
}

// Persists frontend-controlled settings.
export function updateSettings(settings: FrontendSettings): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("settings_update", { settings });
}

// Starts the ChatGPT OAuth sign-in flow for the Codex provider.
export function startLogin(): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("auth_start_login");
}

// Signs out of the ChatGPT account used by the Codex provider.
export function signOut(): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("auth_sign_out");
}

// Starts the browser-based Claude.ai sign-in flow.
export function startClaudeLogin(): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("claude_auth_start_login");
}

// Signs out of the Claude account used by the Claude provider.
export function signOutClaude(): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("claude_auth_sign_out");
}

// Saves a provider and refreshes its model list.
export function saveProvider(provider: ProviderInput): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("provider_save", { provider });
}

// Deletes a provider.
export function deleteProvider(providerId: string): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("provider_delete", { providerId });
}

// Refreshes every provider model catalog from the backend.
export function refreshModels(): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("catalog_refresh_models");
}

// Refreshes one provider model catalog from the backend.
export function refreshProviderModels(providerId: string): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("provider_refresh_models", { providerId });
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

// Sends a user message to the selected provider.
export function sendChat(input: SendMessageRequest): Promise<AppSnapshot> {
  return TauriBridge.invokeCommand<AppSnapshot>("chat_send", { input });
}

// Stops the active provider response stream.
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
