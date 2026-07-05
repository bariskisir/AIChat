// UI text and design constants — business data lives in Rust, not here.
export const STATUS_READY = "Ready.";
export const STATUS_STREAMING = "Streaming answer...";
export const STATUS_STOPPING = "Stopping answer...";
export const STATUS_ANSWER_READY = "Answer ready.";
export const STATUS_NO_ANSWER = "No answer is running.";
export const STATUS_ANSWER_STOPPED = "Answer stopped.";
export const STATUS_ERROR_PREFIX = "Error: ";
export const STATUS_GENERATING = "Generating answer...";
export const PLACEHOLDER_SELECT_MODEL = "Select model";
export const PLACEHOLDER_NO_MODELS = "No models";
export const PLACEHOLDER_EMPTY_CHAT = "Start a new message.";
export const PLACEHOLDER_NEW_CHAT_TITLE = "New chat";
export const BTN_SEND = "Send";
export const BTN_STOP = "Esc to Stop";
export const BTN_STOP_TITLE = "Click or press Esc to stop";
export const BTN_SEND_TITLE = "Send message";
export const IMAGE_ALT_TEXT = "Image";
export const IMAGE_REMOVE_LABEL = "Remove image";
export const IMAGE_REMOVE_TEXT = "X";
export const COPY_ICON_CHECK = "✓";
export const COPY_ICON_DEFAULT = "⎘";
export const COMPOSER_ENTER_BLOCKED = "Press Esc or click Stop to stop.";
export const COMPOSER_EMPTY_ERROR = "Enter a message or paste an image first.";
export const ERROR_LABEL = "Error";
export const LABEL_NONE_TITLE_CASE = "None";
export const LABEL_CURRENT = "Current";
export const LABEL_NO_MATCHES = "No matches";
export const FAVORITE_ICON_INACTIVE = "♡";
export const FAVORITE_ICON_ACTIVE = "♥";
export const FAVORITE_ADD_TITLE = "Add to favorites";
export const FAVORITE_REMOVE_TITLE = "Remove from favorites";
export const TITLE_GEN_NONE = "none";
export const TITLE_GEN_CURRENT = "";
// Effort / reasoning levels (mirrors Rust domain; UI dropdown structure)
export const EFFORT_LOW = "low";
export const EFFORT_MEDIUM = "medium";
export const EFFORT_HIGH = "high";
export const EFFORT_XHIGH = "xhigh";
export const EFFORT_NONE = "none";
export const CLAUDE_EFFORT_MAX = "max";
export const EFFORT_LEVELS = [EFFORT_LOW, EFFORT_MEDIUM, EFFORT_HIGH];
export const EFFORT_DEFAULT = EFFORT_HIGH;
// Verbosity dropdown options (mirrors Rust domain)
export const VERBOSITY_OPTIONS = [
    { value: EFFORT_LOW, label: EFFORT_LOW, title: "Shorter, more direct answers" },
    { value: EFFORT_MEDIUM, label: EFFORT_MEDIUM, title: "Balanced answer detail" },
    { value: EFFORT_HIGH, label: EFFORT_HIGH, title: "More detailed answers" },
];
export const VERBOSITY_DEFAULT = EFFORT_HIGH;
// Link targets (keys match Rust LINK_TARGET_*)
export const LINK_DEVELOPER = "developer";
export const LINK_SOURCE = "source";
// UI Dimensions
export const MIN_SIDEBAR_WIDTH = 80;
export const MAX_SIDEBAR_WIDTH = 360;
export const AUTO_SCROLL_THRESHOLD = 48;
export const DEFAULT_SIDEBAR_WIDTH = 115;
export const COPY_FEEDBACK_MS = 1000;
// Event types
export const EVENT_SNAPSHOT = "snapshot";
export const EVENT_ASSISTANT_DELTA = "assistantDelta";
export const EVENT_SESSION_TITLE = "sessionTitleUpdated";
export const EVENT_ERROR = "error";
export const EVENT_APP = "app-event";
// Keyboard keys
export const KEY = {
    ENTER: "Enter",
    ESCAPE: "Escape",
    SHIFT: "Shift",
    TAB: "Tab",
};
// CSS class names
export const CSS = {
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
    CH_MODEL_DROPDOWN_OPTION_ROW: "ch-model-dropdown__option-row",
    CH_MODEL_DROPDOWN_OPTION: "ch-model-dropdown__option",
    CH_MODEL_DROPDOWN_FAVORITE: "ch-model-dropdown__favorite",
    CH_COMPOSER_PREVIEW_ITEM: "ch-composer__preview-item",
    CH_COMPOSER_THUMB: "ch-composer__thumb",
    CH_COMPOSER_REMOVE: "ch-btn--icon ch-composer__remove-image",
};
// Roles
export const ROLE = {
    USER: "user",
    ASSISTANT: "assistant",
};
// Claude effort dropdown options (mirrors Rust domain)
export const CLAUDE_EFFORT_OPTIONS = [
    { value: EFFORT_LOW, label: EFFORT_LOW, title: "Low Claude effort" },
    { value: EFFORT_MEDIUM, label: EFFORT_MEDIUM, title: "Medium Claude effort" },
    { value: EFFORT_HIGH, label: EFFORT_HIGH, title: "High Claude effort" },
    { value: EFFORT_XHIGH, label: "extra", title: "Extra Claude effort" },
    { value: CLAUDE_EFFORT_MAX, label: CLAUDE_EFFORT_MAX, title: "Max Claude effort" },
];
export const CLAUDE_EFFORT_DEFAULT = CLAUDE_EFFORT_MAX;
