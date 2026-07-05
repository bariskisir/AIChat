/** Tauri backend access for the AI Chat UI. */
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
// Invokes a typed Tauri command through the generated bridge.
export function invokeCommand(command, args) {
    return invoke(command, args);
}
// Subscribes to backend app events.
export function listenAppEvents(handler) {
    return listen("app-event", (event) => {
        handler(event.payload);
    });
}
