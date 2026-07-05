/** Shared frontend state and Tauri invocation helpers. */
import * as Api from "./api.js";
import { getRefs } from "./dom.js";
import * as Renderer from "./render.js";
let cachedRefs = null;
// Resolves DOM references after the DOM helper module is available.
function currentRefs() {
    if (!cachedRefs) {
        cachedRefs = getRefs();
    }
    return cachedRefs;
}
export const refs = new Proxy({}, {
    get(_target, property) {
        return Reflect.get(currentRefs(), property);
    },
});
export const model = {
    appState: null,
    composerDrafts: {},
    pendingImageDataUrls: [],
    copyResetTimer: 0,
    streamAutoScroll: true,
    markdownEnabled: true,
};
// Invokes an action that returns and renders an app snapshot.
export async function renderSnapshot(action) {
    const snapshot = await safeInvoke(action);
    if (snapshot) {
        Renderer.renderState(refs, model, snapshot);
    }
}
// Invokes an async action and renders errors without throwing.
export async function safeInvoke(action) {
    try {
        return await action();
    }
    catch (error) {
        Renderer.renderStatus(refs, String(error), true);
        Renderer.updateButtons(refs, model);
        return null;
    }
}
// Saves frontend settings and renders the refreshed state.
export async function saveSettings() {
    const snapshot = await safeInvoke(() => Api.updateSettings(Renderer.collectSettings(refs)));
    if (snapshot) {
        Renderer.renderState(refs, model, snapshot);
    }
}
