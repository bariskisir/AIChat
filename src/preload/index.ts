/** Exposes the typed, capability-limited AI Chat bridge to the sandboxed renderer. */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  type ApiBridge,
  type ChatStreamEvent,
  type UpdateStateEvent,
} from '@shared/index'

/** Subscribes to one approved event and returns a cleanup callback. */
const subscribe = <T>(channel: IpcChannel, listener: (payload: T) => void): (() => void) => {
  /** Validates the Electron callback shape before forwarding only its payload. */
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ApiBridge = {
  /** Loads settings, conversations, providers, models, and desktop metadata. */
  bootstrap: () => ipcRenderer.invoke(IpcChannel.AppBootstrap),
  /** Persists a validated application-settings patch. */
  saveSettings: (patch) => ipcRenderer.invoke(IpcChannel.SettingsSave, patch),
  /** Creates one empty local chat conversation. */
  createConversation: () => ipcRenderer.invoke(IpcChannel.ConversationCreate),
  /** Loads one complete local chat conversation. */
  getConversation: (id) => ipcRenderer.invoke(IpcChannel.ConversationGet, id),
  /** Persists one complete local chat conversation. */
  saveConversation: (conversation) => ipcRenderer.invoke(IpcChannel.ConversationSave, conversation),
  /** Replaces one chat conversation title. */
  renameConversation: (id, title) =>
    ipcRenderer.invoke(IpcChannel.ConversationRename, { id, title }),
  /** Deletes a chat conversation and returns any required replacement. */
  deleteConversation: (id) => ipcRenderer.invoke(IpcChannel.ConversationDelete, id),
  /** Deletes every chat conversation and returns the required empty replacement. */
  deleteAllConversations: () => ipcRenderer.invoke(IpcChannel.ConversationDeleteAll),
  /** Stores one provider configuration of any supported provider type. */
  saveProvider: (input) => ipcRenderer.invoke(IpcChannel.ProviderSave, input),
  /** Loads one provider's complete editable fields and saved catalog. */
  getProviderEditorData: (id) => ipcRenderer.invoke(IpcChannel.ProviderEditData, id),
  /** Fetches a model catalog with the current unsaved provider form values. */
  fetchProviderCatalog: (input) => ipcRenderer.invoke(IpcChannel.ProviderCatalogFetch, input),
  /** Enables or disables one provider from the overview. */
  setProviderEnabled: (id, enabled) =>
    ipcRenderer.invoke(IpcChannel.ProviderEnabledSet, { id, enabled }),
  /** Persists the exact provider order produced by drag and drop. */
  reorderProviders: (providerIds) => ipcRenderer.invoke(IpcChannel.ProviderOrderSet, providerIds),
  /** Deletes one user-created provider. */
  deleteProvider: (id) => ipcRenderer.invoke(IpcChannel.ProviderDelete, id),
  /** Signs one login-family provider in through its native flow. */
  startProviderSignIn: (providerId, type) =>
    ipcRenderer.invoke(IpcChannel.ProviderAuthStart, { providerId, type }),
  /** Signs one login-family provider out and clears its credentials. */
  signOutProvider: (providerId, type) =>
    ipcRenderer.invoke(IpcChannel.ProviderAuthLogout, { providerId, type }),
  /** Reads the authentication state of one login-family provider. */
  getProviderAuthStatus: (providerId, type) =>
    ipcRenderer.invoke(IpcChannel.ProviderAuthStatus, { providerId, type }),
  /** Fetches the usage overview for one login-family provider. */
  fetchProviderUsage: (providerId) =>
    ipcRenderer.invoke(IpcChannel.ProviderUsageFetch, { providerId }),
  /** Adds or removes a model favorite. */
  setFavoriteModel: (model, favorite) =>
    ipcRenderer.invoke(IpcChannel.ModelFavoriteSet, { model, favorite }),
  /** Persists the model most recently selected in a chat. */
  setLastUsedModel: (model) => ipcRenderer.invoke(IpcChannel.ModelLastUsedSet, model),
  /** Persists the model used for lightweight internal tasks. */
  setQuickModel: (model) => ipcRenderer.invoke(IpcChannel.ModelQuickSet, model),
  /** Persists whether Quick Model title generation is enabled. */
  setTitleGenerationEnabled: (enabled) =>
    ipcRenderer.invoke(IpcChannel.TitleGenerationEnabledSet, enabled),
  /** Starts one validated streaming chat request. */
  startChat: (request) => ipcRenderer.invoke(IpcChannel.ChatStart, request),
  /** Stops one active streaming chat request. */
  stopChat: (requestId) => ipcRenderer.invoke(IpcChannel.ChatStop, requestId),
  /** Opens the native attachment picker for one conversation. */
  selectAttachments: (conversationId) =>
    ipcRenderer.invoke(IpcChannel.AttachmentsSelect, conversationId),
  /** Changes the native always-on-top state. */
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(IpcChannel.WindowAlwaysOnTop, enabled),
  /** Minimizes the main application window. */
  minimizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),
  /** Toggles and reports the native maximized state. */
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),
  /** Closes the main application window. */
  closeWindow: () => ipcRenderer.invoke(IpcChannel.WindowClose),
  /** Reads the current native maximized state. */
  isWindowMaximized: () => ipcRenderer.invoke(IpcChannel.WindowIsMaximized),
  /** Synchronizes native chrome with the resolved theme. */
  setTheme: (theme) => ipcRenderer.invoke(IpcChannel.ThemeSet, theme),
  /** Opens an HTTP(S) target in the system browser. */
  openExternal: (url) => ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url),
  /** Opens AI Chat's private log directory. */
  openLogsDirectory: () => ipcRenderer.invoke(IpcChannel.LogsOpenDirectory),
  /** Shows a save dialog and writes text content to the chosen file. */
  saveFile: (suggestedName, content) =>
    ipcRenderer.invoke(IpcChannel.FileSave, { suggestedName, content }),
  /** Writes one validated renderer diagnostic through the main logger. */
  writeLog: (entry) => ipcRenderer.send(IpcChannel.LogWrite, entry),
  /** Checks the AI Chat GitHub repository for updates. */
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.UpdatesCheck),
  /** Restarts into a downloaded verified installer. */
  installUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesInstall),
  /** Subscribes to chat reasoning, content, citation, title, and completion events. */
  onChatStream: (listener) => subscribe<ChatStreamEvent>(IpcChannel.ChatStream, listener),
  /** Subscribes to desktop update lifecycle events. */
  onUpdateState: (listener) => subscribe<UpdateStateEvent>(IpcChannel.UpdateState, listener),
  /** Subscribes to native maximize-state changes. */
  onWindowMaximizedChange: (listener) =>
    subscribe<boolean>(IpcChannel.WindowMaximizedChanged, listener),
  /** Subscribes to settings navigation requested by native desktop UI. */
  onSettingsOpenRequested: (listener) =>
    subscribe<void>(IpcChannel.SettingsOpenRequested, listener),
}

contextBridge.exposeInMainWorld('app', api)
