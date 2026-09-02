/** Defines chat messages, attachments, citations, usage records, and stream events. */

import type { ChatAttachment } from './attachments'
import type { ModelReference } from './providers'
import type { WebSearchMode } from './conversations'
import type { ReasoningEffort } from './reasoning'

/** Bounds provider error details stored in chat conversations and sent across IPC. */
export const MAX_CHAT_ERROR_LENGTH = 8_000

/** Identifies one durable message role or context boundary. */
export type ChatRole = 'user' | 'assistant' | 'system' | 'boundary'

/** One durable conversation message, including partial streaming state. */
export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  reasoning?: string | undefined
  model?: ModelReference | undefined
  attachments?: ChatAttachment[] | undefined
  citations?: Citation[] | undefined
  searchQueries?: SearchQueryStatus[] | undefined
  usage?: TokenUsage | undefined
  tokenCount?: number | undefined
  reasoningStartedAt?: number | undefined
  durationMs?: number | undefined
  createdAt: string
  status: 'complete' | 'streaming' | 'stopped' | 'error'
  error?: string | undefined
}

/** A web source used while producing an assistant response. */
export interface Citation {
  index: number
  title: string
  url: string
  snippet: string
}

/** Records provider-reported token consumption for one assistant response. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Tracks one in-progress or completed web-search query attached to an assistant message. */
export interface SearchQueryStatus {
  query: string
  engine: string
  count: number
  done?: boolean | undefined
}

/** Request for one streaming provider completion. */
export interface ChatRequest {
  requestId: string
  conversationId: string
  assistantMessageId: string
  model: ModelReference
  messages: ChatMessage[]
  searchMode: WebSearchMode
  useWebSearchFallback: boolean
  reasoningEffort: ReasoningEffort
  imageGeneration: boolean
}

/** Incremental completion events emitted from main to the renderer. */
export type ChatStreamEvent =
  | {
      requestId: string
      type: 'status'
      status: 'generating' | 'generating-title' | 'title-done'
      conversationId?: string
    }
  | {
      requestId: string
      type: 'searchProgress'
      query: string
      engine: Exclude<WebSearchMode, 'off'>
      count: number
      done: boolean
    }
  | { requestId: string; type: 'citations'; citations: Citation[] }
  | {
      requestId: string
      type: 'reasoning'
      delta: string
      conversationId?: string
      assistantMessageId?: string
    }
  | {
      requestId: string
      type: 'content'
      delta: string
      /** Replaces accumulated content instead of appending a streaming delta. */
      replace?: boolean
      conversationId?: string
      assistantMessageId?: string
    }
  | {
      requestId: string
      type: 'usage'
      usage: TokenUsage
      conversationId?: string
      assistantMessageId?: string
    }
  | { requestId: string; type: 'title'; title: string; conversationId?: string }
  | { requestId: string; type: 'complete'; conversationId?: string; assistantMessageId?: string }
  | {
      requestId: string
      type: 'error'
      message: string
      conversationId?: string
      assistantMessageId?: string
    }
