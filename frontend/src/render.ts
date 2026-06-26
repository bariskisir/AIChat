/** Rendering helpers for AI Chat. */

import { type Refs } from "./dom.js";
import {
  applyShowFooter,
  applyShowInfoBar,
  applyShowModelBar,
  populateOptions,
  renderImagePreview,
  renderStatus,
  setSidebarWidth,
  updateButtons,
} from "./render-controls.js";
import { renderMessages } from "./render-messages.js";
import { renderProviders } from "./render-providers.js";
import { renderSessions } from "./render-session.js";

export interface UiModel {
  appState: AppSnapshot | null;
  composerDrafts: Record<string, ComposerDraft>;
  pendingImageDataUrls: string[];
  copyResetTimer: number;
  streamAutoScroll: boolean;
}

export interface ComposerDraft {
  text: string;
  imageDataUrls: string[];
}

// Renders a complete backend snapshot into the UI.
export function renderState(refs: Refs, model: UiModel, state: AppSnapshot): void {
  const previousState = model.appState;
  saveComposerDraft(refs, model);
  const preservedScrollTop = refs.chatMessages.scrollTop;
  const sameSession = previousState?.activeSession.id === state.activeSession.id;
  if (!sameSession || (!previousState?.isGenerating && state.isGenerating)) {
    model.streamAutoScroll = true;
  }
  const streamScrollPaused = sameSession && !model.streamAutoScroll && Boolean(previousState?.isGenerating || state.isGenerating);
  model.appState = state;
  populateOptions(refs, state);
  renderStatus(refs, state.status);
  renderSessions(refs, state);
  renderProviders(refs, state);
  renderMessages(refs, state.activeSession, {
    preservedScrollTop,
    scrollToBottom: !streamScrollPaused,
  });
  setSidebarWidth(refs, state.settings.sidebarWidth);
  applyShowFooter(refs, state.settings.showFooter);
  applyShowInfoBar(refs, state.settings.showInfoBar);
  applyShowModelBar(refs, state.settings.showModelBar);
  pruneComposerDrafts(model, state);
  restoreComposerDraft(refs, model, state.activeSession.id);
  renderImagePreview(refs, model);
  updateButtons(refs, model);
}

// Stores the current unsent composer content for the active chat session.
export function saveComposerDraft(refs: Refs, model: UiModel): void {
  const sessionId = model.appState?.activeSession.id;
  if (!sessionId) {
    return;
  }
  const text = refs.inputComposer.value;
  const imageDataUrls = [...model.pendingImageDataUrls];
  if (!text && imageDataUrls.length === 0) {
    delete model.composerDrafts[sessionId];
    return;
  }
  model.composerDrafts[sessionId] = {
    text,
    imageDataUrls,
  };
}

// Clears any unsent composer content tracked for a session.
export function clearComposerDraft(model: UiModel, sessionId: string): void {
  delete model.composerDrafts[sessionId];
  model.pendingImageDataUrls = [];
}

// Removes drafts for sessions that no longer exist.
function pruneComposerDrafts(model: UiModel, state: AppSnapshot): void {
  const sessionIds = new Set(state.sessions.map((session) => session.id));
  for (const sessionId of Object.keys(model.composerDrafts)) {
    if (!sessionIds.has(sessionId)) {
      delete model.composerDrafts[sessionId];
    }
  }
}

// Loads the active session's unsent composer content into the shared textarea.
function restoreComposerDraft(refs: Refs, model: UiModel, sessionId: string): void {
  const draft = model.composerDrafts[sessionId];
  refs.inputComposer.value = draft?.text ?? "";
  model.pendingImageDataUrls = draft ? [...draft.imageDataUrls] : [];
}

export {
  applyShowFooter,
  applyShowInfoBar,
  applyShowModelBar,
  bindScrollTracking,
  collectSettings,
  renderCopyFeedback,
  renderImagePreview,
  renderStatus,
  updateButtons,
} from "./render-controls.js";
export { renderAssistantMessage, renderMessages } from "./render-messages.js";
export { populateModelOptions, selectModel } from "./render-model.js";
export { renderProviders } from "./render-providers.js";
export { renderSessionTitle, renderSessions } from "./render-session.js";
