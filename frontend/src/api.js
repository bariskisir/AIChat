/** Typed Tauri command wrappers for AI Chat. */
import * as TauriBridge from "./tauri-bridge.js";
// Loads the current backend state snapshot.
export function getSnapshot() {
    return TauriBridge.invokeCommand("app_get_snapshot");
}
// Persists frontend-controlled settings.
export function updateSettings(settings) {
    return TauriBridge.invokeCommand("settings_update", { settings });
}
// Starts the browser-based Claude.ai sign-in flow.
export function startClaudeLogin() {
    return TauriBridge.invokeCommand("claude_auth_start_login");
}
// Signs out of the Claude account used by the Claude provider.
export function signOutClaude() {
    return TauriBridge.invokeCommand("claude_auth_sign_out");
}
// Saves a provider and refreshes its model list.
export function saveProvider(provider) {
    return TauriBridge.invokeCommand("provider_save", { provider });
}
// Deletes a provider.
export function deleteProvider(providerId) {
    return TauriBridge.invokeCommand("provider_delete", { providerId });
}
// Refreshes every provider model catalog from the backend.
export function refreshModels() {
    return TauriBridge.invokeCommand("catalog_refresh_models");
}
// Refreshes one provider model catalog from the backend.
export function refreshProviderModels(providerId) {
    return TauriBridge.invokeCommand("provider_refresh_models", { providerId });
}
// Creates and selects a new local chat session.
export function createSession() {
    return TauriBridge.invokeCommand("session_create");
}
// Selects an existing local chat session.
export function selectSession(sessionId) {
    return TauriBridge.invokeCommand("session_select", { sessionId });
}
// Deletes a local chat session.
export function deleteSession(sessionId) {
    return TauriBridge.invokeCommand("session_delete", { sessionId });
}
// Sends a user message to the selected provider.
export function sendChat(input) {
    return TauriBridge.invokeCommand("chat_send", { input });
}
// Stops the active provider response stream.
export function stopChat(sessionId) {
    return TauriBridge.invokeCommand("chat_stop", { sessionId });
}
// Writes plain text to the system clipboard.
export function writeClipboardText(text) {
    return TauriBridge.invokeCommand("clipboard_write_text", { text });
}
// Opens a known external project link.
export function openLink(target) {
    return TauriBridge.invokeCommand("link_open", { target });
}
// Checks for available updates and returns the result.
export function checkUpdate() {
    return TauriBridge.invokeCommand("check_update");
}
