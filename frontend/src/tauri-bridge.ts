/** Tauri backend access for the ChatGPT Codex UI. */

namespace TauriBridge {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  // Calls a Tauri command through the global frontend bridge.
  export function invokeCommand<T = void>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    return invoke<T>(command, args);
  }

  // Subscribes to backend app events emitted over Tauri.
  export function listenAppEvents(
    handler: (payload: UiEventPayload) => void
  ): Promise<() => void> {
    return listen<UiEventPayload>("app-event", (event) => {
      handler(event.payload);
    });
  }
}
