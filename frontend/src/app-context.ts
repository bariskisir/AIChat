/** Shared frontend state and Tauri invocation helpers. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./render.ts" />
/// <reference path="./api.ts" />

namespace AppContext {
  let cachedRefs: DomRefs.Refs | null = null;

  // Resolves DOM references after the DOM helper namespace is available.
  function currentRefs(): DomRefs.Refs {
    if (!cachedRefs) {
      cachedRefs = DomRefs.getRefs();
    }
    return cachedRefs;
  }

  export const refs = new Proxy({} as DomRefs.Refs, {
    get(_target, property: string | symbol) {
      return Reflect.get(currentRefs(), property);
    },
  });

  export const model: Renderer.UiModel = {
    appState: null,
    pendingImageDataUrls: [],
    copyResetTimer: 0,
  };

  // Invokes an action that returns and renders an app snapshot.
  export async function renderSnapshot(action: () => Promise<AppSnapshot>): Promise<void> {
    const snapshot = await safeInvoke(action);
    if (snapshot) {
      Renderer.renderState(refs, model, snapshot);
    }
  }

  // Invokes an async action and renders errors without throwing.
  export async function safeInvoke<T = void>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      Renderer.renderStatus(refs, String(error), true);
      Renderer.updateButtons(refs, model);
      return null;
    }
  }

  // Saves frontend settings and renders the refreshed state.
  export async function saveSettings(): Promise<void> {
    const snapshot = await safeInvoke(() => Api.updateSettings(Renderer.collectSettings(refs)));
    if (snapshot) {
      Renderer.renderState(refs, model, snapshot);
    }
  }
}
