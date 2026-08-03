/**
 * Verifies renderer state hydration, conversation management, settings, and UI toggles.
 */

import { describe, expect, it } from 'vitest'
import reducer, {
  addConversationSummary,
  hydrate,
  removeConversationSummary,
  replaceConversationSummary,
  replaceCurrentConversation,
  setConversationGenerating,
  setConversationsSidebarOpen,
  setCurrentConversation,
  setPage,
  setSettings,
  setSettingsSection,
  setTitleGeneratingConversationId,
  setUpdateState,
} from '../src/renderer/src/store/appSlice'
import { DEFAULT_SETTINGS, type BootstrapData, type Conversation } from '@shared/index'

/** Creates a minimal deterministic conversation document for reducer tests. */
const conversation = (id: string, title = 'New Conversation'): Conversation => ({
  revision: 1,
  id,
  title,
  isDefaultTitle: title === 'New Conversation',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  selectedModel: null,
  searchMode: 'off',
  lastSearchEngine: 'google',
  reasoningEffort: 'off',
})

const providers: BootstrapData['providers'] = {
  providers: [],
  models: [],
  catalogModels: [],
  favorites: [],
  lastUsedModel: null,
  quickModel: null,
  titleGenerationEnabled: true,
}

describe('appSlice', () => {
  it('hydrates application state once', () => {
    const payload: BootstrapData = {
      settings: { ...DEFAULT_SETTINGS, theme: 'light' },
      conversations: [conversation('00000000-0000-4000-8000-000000000001')],
      currentConversation: conversation('00000000-0000-4000-8000-000000000001'),
      providers,
      platform: 'linux',
      version: '1.0.0',
    }
    const hydrated = reducer(undefined, hydrate(payload))
    const repeated = reducer(hydrated, hydrate({ ...payload, version: '2.0.0' }))

    expect(hydrated.initialized).toBe(true)
    expect(hydrated.settings.theme).toBe('light')
    expect(hydrated.version).toBe('1.0.0')
    expect(repeated.version).toBe('1.0.0')
  })

  it('changes page and settings section', () => {
    const settingsPage = reducer(undefined, setPage('settings'))
    const logging = reducer(settingsPage, setSettingsSection('logging'))
    expect(logging.page).toBe('settings')
    expect(logging.settingsSection).toBe('logging')
  })

  it('tracks title generation animation by conversation identifier', () => {
    const running = reducer(undefined, setTitleGeneratingConversationId(conversation('id').id))
    const stopped = reducer(running, setTitleGeneratingConversationId(null))

    expect(running.titleGeneratingConversationId).toBe('id')
    expect(stopped.titleGeneratingConversationId).toBeNull()
  })

  it('tracks provider activity independently for multiple conversation titles', () => {
    const first = reducer(
      undefined,
      setConversationGenerating({ conversationId: 'first', generating: true }),
    )
    const second = reducer(
      first,
      setConversationGenerating({ conversationId: 'second', generating: true }),
    )
    const completed = reducer(
      second,
      setConversationGenerating({ conversationId: 'first', generating: false }),
    )

    expect(second.generatingConversationIds).toEqual(['first', 'second'])
    expect(completed.generatingConversationIds).toEqual(['second'])
  })

  it('replaces persisted settings', () => {
    const state = reducer(undefined, setSettings({ ...DEFAULT_SETTINGS, logLevel: 'debug' }))
    expect(state.settings.logLevel).toBe('debug')
  })

  it('adds, replaces, and removes conversation summaries', () => {
    const first = conversation('00000000-0000-4000-8000-000000000001')
    const added = reducer(undefined, addConversationSummary(first))
    const replaced = reducer(
      added,
      replaceConversationSummary({ ...first, title: 'Renamed', isDefaultTitle: false }),
    )
    const removed = reducer(replaced, removeConversationSummary(first.id))

    expect(replaced.conversations[0]?.title).toBe('Renamed')
    expect(removed.conversations).toHaveLength(0)
  })

  it('updates only the active conversation document', () => {
    const first = conversation('00000000-0000-4000-8000-000000000001')
    const selected = reducer(undefined, setCurrentConversation(first))
    const ignored = reducer(
      selected,
      replaceCurrentConversation(conversation('00000000-0000-4000-8000-000000000002', 'Other')),
    )
    const replaced = reducer(
      ignored,
      replaceCurrentConversation({ ...first, title: 'Renamed', isDefaultTitle: false }),
    )

    expect(ignored.currentConversation?.title).toBe('New Conversation')
    expect(replaced.currentConversation?.title).toBe('Renamed')
  })

  it('updates sidebar visibility and updater state', () => {
    const hidden = reducer(undefined, setConversationsSidebarOpen(false))
    const updated = reducer(hidden, setUpdateState({ state: 'available', version: '1.1.0' }))
    expect(updated.conversationsSidebarOpen).toBe(false)
    expect(updated.update).toEqual({ state: 'available', version: '1.1.0' })
  })
})
