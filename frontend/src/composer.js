/** Composer input, paste, and submit behavior. */
import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import * as Constants from "./constants.js";
import * as Renderer from "./render.js";
let stopInFlight = false;
// Connects composer controls to message and image actions.
export function bind(refs, model) {
    refs.formComposer.addEventListener("submit", submitMessage);
    refs.inputComposer.addEventListener("input", () => {
        Renderer.saveComposerDraft(refs, model);
        Renderer.updateButtons(refs, model);
    });
    refs.inputComposer.addEventListener("keydown", handleComposerKeydown);
    refs.inputComposer.addEventListener("paste", handleImagePaste);
    document.addEventListener("paste", handleImagePaste);
    document.addEventListener("keydown", handleGlobalKeydown, true);
    refs.composerPreview.addEventListener("click", removePendingImage);
}
// Places the cursor in the message composer for immediate typing.
export function focus() {
    window.requestAnimationFrame(() => {
        AppContext.refs.inputComposer.focus();
    });
}
// Submits the current composer text and optional pasted images.
async function submitMessage(event) {
    event.preventDefault();
    const refs = AppContext.refs;
    const model = AppContext.model;
    if (model.appState?.isGenerating) {
        void stopActiveAnswer();
        return;
    }
    const text = refs.inputComposer.value.trim();
    if (!text && model.pendingImageDataUrls.length === 0) {
        Renderer.renderStatus(refs, Constants.COMPOSER_EMPTY_ERROR, true);
        return;
    }
    await AppContext.saveSettings();
    const snapshot = await AppContext.safeInvoke(() => Api.sendChat({ text, imageDataUrls: [...model.pendingImageDataUrls] }));
    if (snapshot) {
        const sessionId = model.appState?.activeSession?.id;
        refs.inputComposer.value = "";
        if (sessionId) {
            Renderer.clearComposerDraft(model, sessionId);
        }
        else {
            model.pendingImageDataUrls = [];
        }
        Renderer.renderState(refs, model, snapshot);
    }
}
// Sends on Enter and keeps Shift+Enter for multiline input.
function handleComposerKeydown(event) {
    if (event.key === Constants.KEY.ENTER && !event.shiftKey) {
        event.preventDefault();
        if (AppContext.model.appState?.isGenerating) {
            Renderer.renderStatus(AppContext.refs, Constants.COMPOSER_ENTER_BLOCKED);
            return;
        }
        AppContext.refs.formComposer.requestSubmit();
    }
}
// Stops a running answer from the global Escape shortcut.
function handleGlobalKeydown(event) {
    if (event.key !== Constants.KEY.ESCAPE || !AppContext.model.appState?.isGenerating) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    void stopActiveAnswer();
}
// Sends a single stop request for the active streaming answer.
async function stopActiveAnswer() {
    const state = AppContext.model.appState;
    if (!state?.isGenerating || stopInFlight) {
        return;
    }
    stopInFlight = true;
    Renderer.renderStatus(AppContext.refs, Constants.STATUS_STOPPING);
    await AppContext.renderSnapshot(() => Api.stopChat(state.activeSession.id));
    stopInFlight = false;
}
// Captures pasted images as data URLs for the next message.
function handleImagePaste(event) {
    const refs = AppContext.refs;
    const model = AppContext.model;
    if (event.defaultPrevented || !model.appState?.providers?.configured) {
        return;
    }
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file) => Boolean(file));
    if (!files.length) {
        return;
    }
    event.preventDefault();
    Promise.all(files.map(readImageFile)).then((imageDataUrls) => {
        model.pendingImageDataUrls = model.pendingImageDataUrls.concat(imageDataUrls.filter(Boolean));
        Renderer.saveComposerDraft(refs, model);
        Renderer.renderImagePreview(refs, model);
        Renderer.updateButtons(refs, model);
        refs.inputComposer.focus();
    });
}
// Reads a pasted image file into a data URL.
function readImageFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
    });
}
// Removes one pending pasted image from the composer preview.
function removePendingImage(event) {
    const refs = AppContext.refs;
    const model = AppContext.model;
    const button = event.target.closest(`[${"data-image-index"}]`);
    const index = Number(button?.dataset.imageIndex);
    if (!Number.isInteger(index)) {
        return;
    }
    model.pendingImageDataUrls.splice(index, 1);
    Renderer.saveComposerDraft(refs, model);
    Renderer.renderImagePreview(refs, model);
    Renderer.updateButtons(refs, model);
}
