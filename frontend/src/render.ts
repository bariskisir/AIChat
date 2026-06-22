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
  pendingImageDataUrls: string[];
  copyResetTimer: number;
  streamAutoScroll: boolean;
}

// Renders a complete backend snapshot into the UI.
export function renderState(refs: Refs, model: UiModel, state: AppSnapshot): void {
  const previousState = model.appState;
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
  renderImagePreview(refs, model);
  updateButtons(refs, model);
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
