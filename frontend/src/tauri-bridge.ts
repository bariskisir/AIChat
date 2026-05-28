/** Tauri backend access for the Claude Chat UI. */

namespace TauriBridge {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  // Invokes a typed Tauri command through the generated bridge.
  export function invokeCommand<T = void>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    return invoke<T>(command, args);
  }

  // Subscribes to backend app events.
  export function listenAppEvents(
    handler: (payload: UiEventPayload) => void
  ): Promise<() => void> {
    return listen<UiEventPayload>("app-event", (event) => {
      handler(event.payload);
    });
  }
}
