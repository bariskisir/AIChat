/** Defines persisted chat conversations, their summaries, and per-topic preferences. */

import type { ChatMessage } from './chat'
import type { ModelReference } from './providers'
import type { ReasoningEffort } from './reasoning'

/** Lists web-search modes available in each chat conversation. */
export const WEB_SEARCH_MODES = ['off', 'google', 'bing'] as const

/** Identifies one web-search mode or the disabled state. */
export type WebSearchMode = (typeof WEB_SEARCH_MODES)[number]

/** Stores one complete local chat conversation and its per-topic preferences. */
export interface Conversation {
  revision: 1
  id: string
  title: string
  isDefaultTitle: boolean
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  selectedModel: ModelReference | null
  searchMode: WebSearchMode
  lastSearchEngine: Exclude<WebSearchMode, 'off'>
  reasoningEffort: ReasoningEffort
}

/** Stores compact conversation metadata for the left chat list. */
export interface ConversationSummary {
  id: string
  title: string
  isDefaultTitle: boolean
  createdAt: string
  updatedAt: string
}

/** Reports deletion and the optional invariant-preserving replacement conversation. */
export interface DeleteConversationResult {
  deleted: boolean
  replacement?: Conversation | undefined
}
