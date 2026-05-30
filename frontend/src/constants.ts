/// <reference path="./types.d.ts" />

namespace Constants {
  // UI Text
  export const STATUS_READY: string = "Ready.";
  export const STATUS_STREAMING: string = "Streaming answer...";
  export const STATUS_STOPPING: string = "Stopping answer...";
  export const STATUS_ANSWER_READY: string = "Answer ready.";
  export const STATUS_NO_ANSWER: string = "No answer is running.";
  export const STATUS_ANSWER_STOPPED: string = "Answer stopped.";
  export const STATUS_ERROR_PREFIX: string = "Error: ";
  export const STATUS_GENERATING: string = "Generating answer...";
  export const PLACEHOLDER_SELECT_MODEL: string = "Select model";
  export const PLACEHOLDER_NO_MODELS: string = "No models";
  export const PLACEHOLDER_EMPTY_CHAT: string = "Start a new message.";
  export const PLACEHOLDER_NEW_CHAT_TITLE: string = "New chat";
  export const BTN_SEND: string = "Send";
  export const BTN_STOP: string = "Esc to Stop";
  export const BTN_STOP_TITLE: string = "Click or press Esc to stop";
  export const BTN_SEND_TITLE: string = "Send message";
  export const BTN_FULL: string = "Full";
  export const BTN_COMPACT: string = "Compact";
  export const IMAGE_ALT_TEXT: string = "Image";
  export const IMAGE_REMOVE_LABEL: string = "Remove image";
  export const IMAGE_REMOVE_TEXT: string = "X";
  export const COPY_ICON_CHECK: string = "✓";
  export const COPY_ICON_DEFAULT: string = "⎘";
  export const COMPOSER_ENTER_BLOCKED: string = "Press Esc or click Stop to stop.";
  export const COMPOSER_EMPTY_ERROR: string = "Enter a message or paste an image first.";
  export const ERROR_LABEL: string = "Error";

  // Effort / reasoning levels
  export const EFFORT_LOW: EffortLevel = "low";
  export const EFFORT_MEDIUM: EffortLevel = "medium";
  export const EFFORT_HIGH: EffortLevel = "high";
  export const EFFORT_NONE: EffortSetting = "none";
  export const EFFORT_LEVELS: readonly EffortLevel[] = [EFFORT_LOW, EFFORT_MEDIUM, EFFORT_HIGH] as const;
  export const EFFORT_DEFAULT: EffortLevel = EFFORT_HIGH;

  // Verbosity levels
  export const VERBOSITY_OPTIONS: readonly { value: VerbosityLevel; label: string; title: string }[] = [
    { value: "low", label: "low", title: "Shorter, more direct answers" },
    { value: "medium", label: "medium", title: "Balanced answer detail" },
    { value: "high", label: "high", title: "More detailed answers" },
  ] as const;
  export const VERBOSITY_DEFAULT: VerbosityLevel = "medium";

  // Provider URLs
  export const CODEX_API_URL: string = "codex://chatgpt";
  export const CLAUDE_API_URL: string = "claude://claude.ai";

  // Link targets
  export const LINK_DEVELOPER: LinkTarget = "developer" as const;
  export const LINK_SOURCE: LinkTarget = "source" as const;

  // UI Dimensions
  export const MIN_SIDEBAR_WIDTH: number = 80;
  export const MAX_SIDEBAR_WIDTH: number = 360;
  export const AUTO_SCROLL_THRESHOLD: number = 48;
  export const DEFAULT_SIDEBAR_WIDTH: number = 115;
  export const COPY_FEEDBACK_MS: number = 1000;

  // Event types
  export const EVENT_SNAPSHOT: EventType = "snapshot" as const;
  export const EVENT_ASSISTANT_DELTA: EventType = "assistantDelta" as const;
  export const EVENT_SESSION_TITLE: EventType = "sessionTitleUpdated" as const;
  export const EVENT_ERROR: EventType = "error" as const;
  export const EVENT_APP: string = "app-event" as const;

  // Keyboard keys
  export const KEY: { readonly ENTER: "Enter"; readonly ESCAPE: "Escape"; readonly SHIFT: "Shift" } = {
    ENTER: "Enter",
    ESCAPE: "Escape",
    SHIFT: "Shift",
  } as const;

  // CSS class names
  export const CSS: { readonly [key: string]: string } = {
    IS_COMPACT: "is-compact",
    IS_ACTIVE: "is-active",
    IS_ERROR: "is-error",
    IS_COPIED: "is-copied",
    IS_PENDING: "is-pending",
    IS_HIDDEN: "is-hidden",
    IS_STOP: "is-stop",
    IS_DISABLED: "is-disabled",
    CH_BUBBLE: "ch-bubble",
    CH_BUBBLE_TEXT: "ch-bubble__text",
    CH_BUBBLE_IMAGE: "ch-bubble__image",
    CH_CHAT_EMPTY: "ch-chat__empty",
    CH_MD: "ch-md",
    CH_FOOTER: "ch-footer",
    CH_SIDEBAR: "ch-sidebar",
    CH_SIDEBAR_ITEM: "ch-sidebar__item",
    CH_SIDEBAR_TITLE: "ch-sidebar__title",
    CH_SIDEBAR_DELETE: "ch-btn--delete ch-sidebar__delete",
    CH_MODEL_DROPDOWN_EMPTY: "ch-model-dropdown__empty",
    CH_MODEL_DROPDOWN_OPTION: "ch-model-dropdown__option",
    CH_COMPOSER_PREVIEW_ITEM: "ch-composer__preview-item",
    CH_COMPOSER_THUMB: "ch-composer__thumb",
    CH_COMPOSER_REMOVE: "ch-btn--icon ch-composer__remove-image",
  } as const;

  // Roles
  export const ROLE = {
    USER: "user" as ChatRole,
    ASSISTANT: "assistant" as ChatRole,
  } as const;
}
