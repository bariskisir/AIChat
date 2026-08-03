/** Defines the typed, allow-listed bridge exposed to the sandboxed renderer. */

import type { AppSettings, AppSettingsPatch } from '../domain/app-settings'
import type { ChatAttachment } from '../domain/attachments'
import type { ChatRequest, ChatStreamEvent } from '../domain/chat'
import type {
  Conversation,
  ConversationSummary,
  DeleteConversationResult,
} from '../domain/conversations'
import type {
  ModelReference,
  ProviderAuthStatus,
  ProviderConnectionInput,
  ProviderEditorData,
  ProviderInput,
  ProviderModelDefinition,
  ProviderSnapshot,
  ProviderType,
  ProviderUsageState,
} from '../domain/providers'
import type { LogRecord } from '../domain/runtime'
import type { DesktopPlatform } from '../domain/runtime'
import type { ThemeMode } from '../domain/app-settings'
import type { UpdateStateEvent } from '../domain/updates'

/** Hydrates the renderer with all state needed for first render. */
export interface BootstrapData {
  settings: AppSettings
  conversations: ConversationSummary[]
  currentConversation: Conversation
  providers: ProviderSnapshot
  platform: DesktopPlatform
  version: string
}

/** Typed, allow-listed Electron bridge exposed to the sandboxed renderer. */
export interface ApiBridge {
  /** Loads settings, conversations, provider metadata, model catalogs, and desktop identity. */
  bootstrap(): Promise<BootstrapData>
  /** Persists a validated application-settings patch. */
  saveSettings(patch: AppSettingsPatch): Promise<AppSettings>
  /** Creates one empty local chat conversation. */
  createConversation(): Promise<Conversation>
  /** Loads one complete local chat conversation. */
  getConversation(id: string): Promise<Conversation | null>
  /** Atomically persists one complete chat conversation. */
  saveConversation(conversation: Conversation): Promise<Conversation>
  /** Replaces a conversation's generated or custom title. */
  renameConversation(id: string, title: string): Promise<Conversation>
  /** Deletes a conversation and returns a fresh replacement when it was the final conversation. */
  deleteConversation(id: string): Promise<DeleteConversationResult>
  /** Deletes every conversation and returns a fresh empty conversation. */
  deleteAllConversations(): Promise<Conversation>
  /** Saves one provider configuration of any supported provider type. */
  saveProvider(input: ProviderInput): Promise<ProviderSnapshot>
  /** Loads one provider's editable fields, plaintext API key, and saved model catalog. */
  getProviderEditorData(id: string): Promise<ProviderEditorData>
  /** Fetches the provider model catalog with the current unsaved form credentials. */
  fetchProviderCatalog(input: ProviderConnectionInput): Promise<ProviderModelDefinition[]>
  /** Starts the provider-specific sign-in flow (OAuth browser or embedded login window). */
  startProviderSignIn(providerId: string, type: ProviderType): Promise<void>
  /** Signs out one login-based provider and clears its stored credentials. */
  signOutProvider(providerId: string, type: ProviderType): Promise<void>
  /** Returns the current authentication state for one login-based provider. */
  getProviderAuthStatus(providerId: string, type: ProviderType): Promise<ProviderAuthStatus>
  /** Fetches rate-limit usage for one provider account. */
  fetchProviderUsage(providerId: string): Promise<ProviderUsageState>
  /** Enables or disables one provider from the provider overview. */
  setProviderEnabled(id: string, enabled: boolean): Promise<ProviderSnapshot>
  /** Persists the exact drag-and-drop provider order. */
  reorderProviders(providerIds: string[]): Promise<ProviderSnapshot>
  /** Deletes one user-created provider. */
  deleteProvider(id: string): Promise<ProviderSnapshot>
  /** Adds or removes one provider-qualified model favorite. */
  setFavoriteModel(model: ModelReference, favorite: boolean): Promise<ProviderSnapshot>
  /** Persists the model most recently selected explicitly in chat. */
  setLastUsedModel(model: ModelReference): Promise<ProviderSnapshot>
  /** Persists the model used for title generation and search query planning. */
  setQuickModel(model: ModelReference | null): Promise<ProviderSnapshot>
  /** Enables or disables Quick Model title generation. */
  setTitleGenerationEnabled(enabled: boolean): Promise<ProviderSnapshot>
  /** Starts one validated incremental completion request. */
  startChat(request: ChatRequest): Promise<void>
  /** Aborts one active completion while retaining its partial content. */
  stopChat(requestId: string): Promise<void>
  /** Opens the native picker and prepares private attachment copies. */
  selectAttachments(conversationId: string): Promise<ChatAttachment[]>
  /** Changes the native always-on-top state. */
  setAlwaysOnTop(enabled: boolean): Promise<void>
  /** Minimizes the main application window. */
  minimizeWindow(): Promise<void>
  /** Toggles the native maximized state and reports the result. */
  toggleMaximizeWindow(): Promise<boolean>
  /** Closes the main application window. */
  closeWindow(): Promise<void>
  /** Reads the current native maximized state. */
  isWindowMaximized(): Promise<boolean>
  /** Synchronizes native title-bar colors with the renderer theme. */
  setTheme(theme: Exclude<ThemeMode, 'system'>): Promise<void>
  /** Opens an HTTP(S) URL in the system browser. */
  openExternal(url: string): Promise<void>
  /** Opens AI Chat's private log directory. */
  openLogsDirectory(): Promise<void>
  /** Shows a save dialog and writes text content to the chosen file. */
  saveFile(suggestedName: string, content: string): Promise<boolean>
  /** Persists one validated renderer diagnostic through the main logger. */
  writeLog(entry: LogRecord): void
  /** Checks the configured GitHub repository for a newer AI Chat release. */
  checkForUpdates(): Promise<void>
  /** Launches a downloaded, verified update installer. */
  installUpdate(): Promise<void>
  /** Subscribes to chat status, citation, reasoning, content, usage, title, and completion events. */
  onChatStream(listener: (event: ChatStreamEvent) => void): () => void
  /** Subscribes to desktop updater lifecycle events. */
  onUpdateState(listener: (event: UpdateStateEvent) => void): () => void
  /** Subscribes to native maximize and restore events. */
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Subscribes to settings navigation requested by native desktop UI. */
  onSettingsOpenRequested(listener: () => void): () => void
}
