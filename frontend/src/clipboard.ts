/** Clipboard actions for copying chat output. */

import * as Api from "./api.js";
import * as AppContext from "./app-context.js";
import * as MessageUtils from "./message-utils.js";
import * as Renderer from "./render.js";

// Copies the active chat transcript to the clipboard.
export async function copyLastAssistant(): Promise<void> {
  const text = MessageUtils.transcriptText(AppContext.model.appState?.activeSession);
  if (!text) {
    return;
  }
  try {
    await writeClipboardText(text);
    Renderer.renderCopyFeedback(AppContext.refs, AppContext.model);
  } catch (error) {
    Renderer.renderStatus(AppContext.refs, `Could not copy output: ${error}`, true);
  }
}

// Writes clipboard text through native, browser, or fallback paths.
async function writeClipboardText(text: string): Promise<void> {
  try {
    await Api.writeClipboardText(text);
    return;
  } catch {
    // Continue to browser clipboard fallback.
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Continue to textarea fallback.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("clipboard write failed");
  }
}
