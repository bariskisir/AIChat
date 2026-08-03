/**
 * Stores application settings, conversation history, and update progress.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BootstrapData,
  type Conversation,
  type ConversationSummary,
  type ProviderSnapshot,
  type UpdateStateEvent,
} from '@shared/index'

export type AppPage = 'home' | 'settings'
export type SettingsSection =
  'general' | 'providers' | 'quickModel' | 'display' | 'updates' | 'about' | 'logging'

export interface AppState {
  initialized: boolean
  page: AppPage
  settingsSection: SettingsSection
  settings: AppSettings
  platform: BootstrapData['platform']
  version: string
  conversations: ConversationSummary[]
  currentConversation: Conversation | null
  providers: ProviderSnapshot
  update: UpdateStateEvent
  conversationsSidebarOpen: boolean
  conversationsSidebarWidth: number
  generatingConversationIds: string[]
  titleGeneratingConversationId: string | null
}

const initialState: AppState = {
  initialized: false,
  page: 'home',
  settingsSection: 'general',
  settings: DEFAULT_SETTINGS,
  platform: 'win32',
  version: '0.0.0',
  conversations: [],
  currentConversation: null,
  providers: {
    providers: [],
    models: [],
    catalogModels: [],
    favorites: [],
    lastUsedModel: null,
    quickModel: null,
    titleGenerationEnabled: true,
  },
  update: { state: 'idle' },
  conversationsSidebarOpen: true,
  conversationsSidebarWidth: 266,
  generatingConversationIds: [],
  titleGeneratingConversationId: null,
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    /** Hydrates the renderer with persisted main-process state. */
    hydrate(state, action: PayloadAction<BootstrapData>) {
      if (state.initialized) return
      state.initialized = true
      state.settings = action.payload.settings
      state.platform = action.payload.platform
      state.version = action.payload.version
      state.conversations = action.payload.conversations
      state.currentConversation = action.payload.currentConversation
      state.providers = action.payload.providers
    },
    /** Opens a top-level application page. */
    setPage(state, action: PayloadAction<AppPage>) {
      state.page = action.payload
    },
    /** Selects the settings category shown when the settings page is opened. */
    setSettingsSection(state, action: PayloadAction<SettingsSection>) {
      state.settingsSection = action.payload
    },
    /** Replaces settings after successful persistence. */
    setSettings(state, action: PayloadAction<AppSettings>) {
      state.settings = action.payload
    },
    /** Inserts a newly created summary at the front without duplicating its identifier. */
    addConversationSummary(state, action: PayloadAction<ConversationSummary>) {
      state.conversations = [
        action.payload,
        ...state.conversations.filter((item) => item.id !== action.payload.id),
      ]
    },
    /** Replaces a known summary in place, or inserts it when not yet synchronized. */
    replaceConversationSummary(state, action: PayloadAction<ConversationSummary>) {
      const index = state.conversations.findIndex((item) => item.id === action.payload.id)
      if (index === -1) state.conversations.unshift(action.payload)
      else state.conversations[index] = action.payload
    },
    /** Removes one conversation summary by its durable identifier. */
    removeConversationSummary(state, action: PayloadAction<string>) {
      state.conversations = state.conversations.filter((item) => item.id !== action.payload)
    },
    /** Sets the conversation displayed in the main workspace. */
    setCurrentConversation(state, action: PayloadAction<Conversation | null>) {
      state.currentConversation = action.payload
    },
    /** Refreshes a document only when it is still the active conversation. */
    replaceCurrentConversation(state, action: PayloadAction<Conversation>) {
      if (state.currentConversation?.id === action.payload.id) {
        state.currentConversation = action.payload
      }
    },
    /** Replaces provider metadata, model catalogs, favorites, and model preferences. */
    setProviders(state, action: PayloadAction<ProviderSnapshot>) {
      state.providers = action.payload
    },
    /** Applies desktop updater progress. */
    setUpdateState(state, action: PayloadAction<UpdateStateEvent>) {
      state.update = action.payload
    },
    /** Shows or hides the conversation management sidebar. */
    setConversationsSidebarOpen(state, action: PayloadAction<boolean>) {
      state.conversationsSidebarOpen = action.payload
    },
    /** Sets the conversation sidebar width chosen by dragging its edge. */
    setConversationsSidebarWidth(state, action: PayloadAction<number>) {
      state.conversationsSidebarWidth = action.payload
    },
    /** Tracks conversations with at least one provider operation still in progress. */
    setConversationGenerating(
      state,
      action: PayloadAction<{ conversationId: string; generating: boolean }>,
    ) {
      const { conversationId, generating } = action.payload
      state.generatingConversationIds = state.generatingConversationIds.filter(
        (id) => id !== conversationId,
      )
      if (generating) state.generatingConversationIds.push(conversationId)
    },
    /** Tracks the chat whose generated title is currently animating in the sidebar. */
    setTitleGeneratingConversationId(state, action: PayloadAction<string | null>) {
      state.titleGeneratingConversationId = action.payload
    },
  },
})

export const {
  addConversationSummary,
  hydrate,
  removeConversationSummary,
  replaceCurrentConversation,
  replaceConversationSummary,
  setCurrentConversation,
  setPage,
  setProviders,
  setSettings,
  setSettingsSection,
  setConversationGenerating,
  setConversationsSidebarOpen,
  setConversationsSidebarWidth,
  setTitleGeneratingConversationId,
  setUpdateState,
} = appSlice.actions

export default appSlice.reducer
