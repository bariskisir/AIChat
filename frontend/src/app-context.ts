/** Shared frontend state and Tauri invocation helpers. */

import * as Api from "./api.js";
import { getRefs, type Refs } from "./dom.js";
import * as Renderer from "./render.js";
import { type UiModel } from "./render.js";

let cachedRefs: Refs | null = null;

// Resolves DOM references after the DOM helper module is available.
function currentRefs(): Refs {
  if (!cachedRefs) {
    cachedRefs = getRefs();
  }
  return cachedRefs;
}

export const refs = new Proxy({} as Refs, {
  get(_target, property: string | symbol) {
    return Reflect.get(currentRefs(), property);
  },
});

export const model: UiModel = {
  appState: null,
  composerDrafts: {},
  pendingImageDataUrls: [],
  copyResetTimer: 0,
  streamAutoScroll: true,
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
