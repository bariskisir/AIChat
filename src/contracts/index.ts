/** Barrel exports for the cross-process contract layer. */

export { IpcChannel } from './api/ipc.channel'
export type { ApiBridge, BootstrapData } from './api/bridge.contract'
export {
  APP_LOCALES,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  THEME_MODES,
  TIME_FORMATS,
} from './domain/app-settings'
export type {
  AppLocale,
  AppSettings,
  AppSettingsPatch,
  LogLevel,
  NavbarPosition,
  ThemeMode,
  TimeFormat,
} from './domain/app-settings'
export type { ChatAttachment } from './domain/attachments'
export { MAX_CHAT_ERROR_LENGTH } from './domain/chat'
export type {
  ChatMessage,
  ChatRequest,
  ChatRole,
  ChatStreamEvent,
  Citation,
  SearchQueryStatus,
  TokenUsage,
} from './domain/chat'
export { WEB_SEARCH_MODES } from './domain/conversations'
export type {
  Conversation,
  ConversationSummary,
  DeleteConversationResult,
  WebSearchMode,
} from './domain/conversations'
export {
  getProviderReasoningEfforts,
  OPENAI_COMPATIBLE_REASONING_EFFORTS,
  PROVIDER_TYPES,
} from './domain/providers'
export type {
  ModelCapabilities,
  ModelDescriptor,
  ModelReference,
  ProviderAuthStatus,
  ProviderConnectionInput,
  ProviderEditorData,
  ProviderInput,
  ProviderModelDefinition,
  ProviderSnapshot,
  ProviderSummary,
  ProviderType,
  ProviderUsageState,
  ProviderUsageWindow,
} from './domain/providers'
export { REASONING_EFFORTS, isReasoningEffortValue } from './domain/reasoning'
export type { ReasoningEffort } from './domain/reasoning'
export type { DesktopPlatform, LogRecord } from './domain/runtime'
export type { UpdateStateEvent } from './domain/updates'
export { APP_AUTHOR, APP_AUTHOR_URL, APP_REPO, APP_REPO_URL } from './constants/app.info'
export { estimateTextTokens } from './utils/token.estimation'
export { clampSurrogateBoundary } from './utils/text'
export { parseDataUrl, isBase64ImageDataUrl, sanitizeMediaType } from './utils/dataUrl'
export type { DataUrlParts } from './utils/dataUrl'
