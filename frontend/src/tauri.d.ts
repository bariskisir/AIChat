/** Tauri v2 global API type declarations. */

interface TauriEvent<T> {
  payload: T;
}

interface Window {
  __TAURI__: {
    core: {
      // Invokes a backend Tauri command and resolves with its typed result.
      invoke<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    };
    event: {
      // Subscribes to a Tauri event and returns an unsubscribe callback.
      listen<T>(
        event: string,
        handler: (event: TauriEvent<T>) => void
      ): Promise<() => void>;
    };
  };
}
