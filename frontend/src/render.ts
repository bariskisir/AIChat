/** Rendering helpers for AI Chat. */
/// <reference path="./types.d.ts" />
/// <reference path="./dom.ts" />
/// <reference path="./render-messages.ts" />
/// <reference path="./render-session.ts" />
/// <reference path="./render-providers.ts" />
/// <reference path="./render-controls.ts" />

namespace Renderer {
  export interface UiModel {
    appState: AppSnapshot | null;
    pendingImageDataUrls: string[];
    copyResetTimer: number;
    streamAutoScroll: boolean;
  }

  // Renders a complete backend snapshot into the UI.
  export function renderState(refs: DomRefs.Refs, model: UiModel, state: AppSnapshot): void {
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
    setCompactMode(refs, state.settings.compactMode);
    setSidebarWidth(refs, state.settings.sidebarWidth);
    applyShowFooter(refs, state.settings.showFooter);
    applyShowInfoBar(refs, state.settings.showInfoBar);
    renderImagePreview(refs, model);
    updateButtons(refs, model);
  }
}
