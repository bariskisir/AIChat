/** Composer input, paste, and submit behavior. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./render.ts" />
/// <reference path="./api.ts" />
/// <reference path="./app-context.ts" />

namespace Composer {
  // Connects composer controls to message and image actions.
  export function bind(refs: DomRefs.Refs, model: Renderer.UiModel): void {
    refs.formComposer.addEventListener("submit", submitMessage);
    refs.inputComposer.addEventListener("input", () => Renderer.updateButtons(refs, model));
    refs.inputComposer.addEventListener("keydown", handleComposerKeydown);
    refs.inputComposer.addEventListener("paste", handleImagePaste);
    document.addEventListener("paste", handleImagePaste);
    refs.composerPreview.addEventListener("click", removePendingImage);
  }

  // Places the cursor in the message composer for immediate typing.
  export function focus(): void {
    window.requestAnimationFrame(() => {
      AppContext.refs.inputComposer.focus();
    });
  }

  // Submits the current composer text and optional pasted images.
  async function submitMessage(event: Event): Promise<void> {
    event.preventDefault();
    const refs = AppContext.refs;
    const model = AppContext.model;
    if (model.appState?.isGenerating) {
      const sessionId = model.appState.activeSession.id;
      await AppContext.renderSnapshot(() => Api.stopChat(sessionId));
      return;
    }
    const text = refs.inputComposer.value.trim();
    if (!text && model.pendingImageDataUrls.length === 0) {
      Renderer.renderStatus(refs, "Enter a message or paste an image first.", true);
      return;
    }
    await AppContext.saveSettings();
    const snapshot = await AppContext.safeInvoke(() =>
      Api.sendChat({ text, imageDataUrls: [...model.pendingImageDataUrls] }),
    );
    if (snapshot) {
      refs.inputComposer.value = "";
      model.pendingImageDataUrls = [];
      Renderer.renderState(refs, model, snapshot);
    }
  }

  // Sends on Enter and keeps Shift+Enter for multiline input.
  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      AppContext.refs.formComposer.requestSubmit();
    }
  }

  // Captures pasted images as data URLs for the next message.
  function handleImagePaste(event: ClipboardEvent): void {
    const refs = AppContext.refs;
    const model = AppContext.model;
    if (event.defaultPrevented || !model.appState?.providers.configured) {
      return;
    }
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) {
      return;
    }
    event.preventDefault();
    Promise.all(files.map(readImageFile)).then((imageDataUrls) => {
      model.pendingImageDataUrls = model.pendingImageDataUrls.concat(imageDataUrls.filter(Boolean));
      Renderer.renderImagePreview(refs, model);
      Renderer.updateButtons(refs, model);
      refs.inputComposer.focus();
    });
  }

  // Reads a pasted image file into a data URL.
  function readImageFile(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  // Removes one pending pasted image from the composer preview.
  function removePendingImage(event: MouseEvent): void {
    const refs = AppContext.refs;
    const model = AppContext.model;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-image-index]");
    const index = Number(button?.dataset.imageIndex);
    if (!Number.isInteger(index)) {
      return;
    }
    model.pendingImageDataUrls.splice(index, 1);
    Renderer.renderImagePreview(refs, model);
    Renderer.updateButtons(refs, model);
  }
}
