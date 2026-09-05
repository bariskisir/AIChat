/** Composes the topic header, streamed timeline, and chat tools. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Input, Modal, Tooltip } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import {
  Eraser,
  Image,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Paperclip,
  Send,
  Square,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  estimateTextTokens,
  getProviderReasoningEfforts,
  type ChatAttachment,
  type ChatMessage,
  type ChatRequest,
  type ChatStreamEvent,
  type Conversation,
  type ModelReference,
  type WebSearchMode,
} from '@shared/index'
import { useConversationActions } from '@renderer/hooks/useConversationActions'
import { useInputHistory } from '@renderer/hooks/useInputHistory'
import { shouldHandleInputHistoryNavigation } from '@renderer/hooks/inputHistoryNavigation'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addConversationSummary,
  replaceConversationSummary,
  setCurrentConversation,
  setProviders,
  setConversationGenerating,
  setTitleGeneratingConversationId,
} from '@renderer/store/appSlice'
import { toConversationSummary } from '@renderer/utils/formatters'
import {
  clampText,
  formatCharacterCount,
  MAX_PASTED_TEXT_CHARACTERS,
  shouldAttachPastedText,
} from '@renderer/utils/largeText'
import MessageBubble from './MessageBubble'
import ModelSelect, { modelReferenceKey } from './ModelSelect'
import ReasoningControl from './ReasoningControl'
import WebSearchControl from './WebSearchControl'
import styles from './ChatWorkspace.module.scss'

const logger = createLogger('ChatWorkspace')
/** Attachments one message may carry, matching the persisted and IPC bounds. */
const MAX_ATTACHMENTS = 10

interface ActiveRequest {
  messageId: string
  conversationId: string
}

/** Creates one locally identified chat message with a normalized initial status. */
const createMessage = (
  role: ChatMessage['role'],
  content: string,
  status: ChatMessage['status'] = 'complete',
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString(),
  status,
})

/** Converts one descriptor-like model object into its persistent provider-qualified reference. */
const toModelReference = (model: ModelReference): ModelReference => ({
  providerId: model.providerId,
  modelId: model.modelId,
})

/** Renders and owns the complete chat interaction for the currently selected local topic. */
/** Freezes the elapsed duration of a message that is no longer streaming. */
const freezeDuration = (item: ChatMessage): ChatMessage => {
  if (item.durationMs !== undefined) return item
  const start = item.reasoningStartedAt ?? Date.parse(item.createdAt)
  return { ...item, durationMs: Math.max(0, Date.now() - start) }
}

interface ChatWorkspaceProps {
  expanded: boolean
  onToggleExpanded: () => void
}

const ChatWorkspace = ({ expanded, onToggleExpanded }: ChatWorkspaceProps): React.JSX.Element => {
  const currentConversation = useAppSelector((state) => state.app.currentConversation)
  const snapshot = useAppSelector((state) => state.app.providers)
  const dispatch = useAppDispatch()
  const conversationActions = useConversationActions()
  const { message, modal } = App.useApp()
  const { t } = useTranslation()
  const conversationRef = useRef<Conversation | null>(currentConversation)
  const activeRequests = useRef(new Map<string, ActiveRequest>())
  const pendingDeltasRef = useRef(new Map<string, { content: string; reasoning: string }>())
  const deltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const lastMessageCount = useRef(0)
  const userScrolledUpRef = useRef(false)
  const inputRef = useRef<TextAreaRef>(null)
  const isComposingRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [imageGeneration, setImageGeneration] = useState(false)
  const [alternateTargetId, setAlternateTargetId] = useState<string | null>(null)
  const [alternateModel, setAlternateModel] = useState<ModelReference | null>(null)
  const currentConversationId = currentConversation?.id

  const inputHistory = useInputHistory({
    applyDraft: useCallback((text: string) => setDraft(text), []),
  })

  const activeRequestCount = currentConversation?.messages.some(
    (m) => m.status === 'streaming' && m.role === 'assistant',
  )
    ? 1
    : 0

  /** Synchronizes one sidebar activity marker from the authoritative active-request map. */
  const syncConversationGeneratingState = useCallback(
    (conversationId: string): void => {
      const generating = [...activeRequests.current.values()].some(
        (request) => request.conversationId === conversationId,
      )
      dispatch(setConversationGenerating({ conversationId, generating }))
    },
    [dispatch],
  )

  /** Replaces the current topic through both a synchronous ref and Redux. */
  const updateConversation = useCallback(
    (transform: (conversation: Conversation) => Conversation): void => {
      const current = conversationRef.current
      if (!current) return
      const next = { ...transform(current), updatedAt: new Date().toISOString() }
      conversationRef.current = next
      dispatch(setCurrentConversation(next))
    },
    [dispatch],
  )

  /** Applies one immutable message transformation by identifier. */
  const updateMessage = useCallback(
    (id: string, transform: (message: ChatMessage) => ChatMessage): void => {
      updateConversation((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) => (item.id === id ? transform(item) : item)),
      }))
    },
    [updateConversation],
  )

  /** Applies every accumulated stream delta for the active topic in one bounded update. */
  const flushPendingDeltas = useCallback((): void => {
    deltaFlushTimerRef.current = null
    const pending = pendingDeltasRef.current
    if (pending.size === 0) return
    pendingDeltasRef.current = new Map()
    updateConversation((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((item) => {
        const delta = pending.get(item.id)
        if (!delta) return item
        return {
          ...item,
          content: delta.content ? item.content + delta.content : item.content,
          reasoning: delta.reasoning ? (item.reasoning ?? '') + delta.reasoning : item.reasoning,
          reasoningStartedAt: delta.reasoning
            ? (item.reasoningStartedAt ?? Date.now())
            : item.reasoningStartedAt,
        }
      }),
    }))
  }, [updateConversation])

  /** Queues one stream delta and schedules a single flush, coalescing IPC bursts. */
  const queueStreamDelta = useCallback(
    (messageId: string, delta: { content?: string; reasoning?: string }): void => {
      const current = pendingDeltasRef.current.get(messageId) ?? { content: '', reasoning: '' }
      pendingDeltasRef.current.set(messageId, {
        content: current.content + (delta.content ?? ''),
        reasoning: current.reasoning + (delta.reasoning ?? ''),
      })
      if (deltaFlushTimerRef.current) return
      deltaFlushTimerRef.current = window.setTimeout(() => flushPendingDeltas(), 16)
    },
    [flushPendingDeltas],
  )

  useEffect(() => {
    conversationRef.current = currentConversation
  }, [currentConversation])

  useEffect(() => {
    if (!currentConversationId) return
    setDraft('')
    setAttachments([])
    setImageGeneration(false)
    setAlternateTargetId(null)
    setAlternateModel(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [currentConversationId])

  const selectedModelKey = currentConversation?.selectedModel
    ? modelReferenceKey(currentConversation.selectedModel)
    : null

  useEffect(() => {
    if (!selectedModelKey) return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [selectedModelKey])

  useEffect(() => {
    if (!currentConversation) return
    const selectedIsAvailable = snapshot.models.some(
      (model) =>
        model.capabilities.chat &&
        model.providerId === currentConversation.selectedModel?.providerId &&
        model.modelId === currentConversation.selectedModel.modelId,
    )
    if (selectedIsAvailable) return
    const lastUsedIsAvailable = snapshot.models.some(
      (model) =>
        model.capabilities.chat &&
        model.providerId === snapshot.lastUsedModel?.providerId &&
        model.modelId === snapshot.lastUsedModel.modelId,
    )
    const firstChatModel = snapshot.models.find((model) => model.capabilities.chat)
    const nextSelection: ModelReference | null = lastUsedIsAvailable
      ? snapshot.lastUsedModel
      : (firstChatModel ?? null)
    const current = currentConversation.selectedModel
    if (
      current?.providerId === nextSelection?.providerId &&
      current?.modelId === nextSelection?.modelId
    ) {
      return
    }
    const next = { ...currentConversation, selectedModel: nextSelection }
    conversationRef.current = next
    dispatch(setCurrentConversation(next))
  }, [currentConversation, dispatch, snapshot.lastUsedModel, snapshot.models])

  useEffect(() => {
    const el = timelineRef.current
    if (!el) return

    const messageCount = currentConversation?.messages.length ?? 0
    const isNewMessage = messageCount > lastMessageCount.current
    lastMessageCount.current = messageCount

    if (isNewMessage || !userScrolledUpRef.current) {
      const timer = window.setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
      }, 16)
      return () => window.clearTimeout(timer)
    }
  }, [currentConversation?.messages])

  useEffect(() => {
    const el = timelineRef.current
    if (!el || !currentConversation?.id) return
    userScrolledUpRef.current = false
    lastMessageCount.current = 0
    /** Tracks whether manual scrolling has moved the user away from the latest message. */
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      userScrolledUpRef.current = !atBottom
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [currentConversation?.id])

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!currentConversation) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void window.app.saveConversation(currentConversation).catch((error: unknown) => {
        logger.error('Chat topic could not be persisted.', error)
      })
    }, 500)
  }, [currentConversation])

  useEffect(() => {
    if (activeRequestCount === 0) return
    const timer = window.setInterval(() => {
      const conversation = conversationRef.current
      if (conversation) {
        void window.app.saveConversation(conversation).catch((error: unknown) => {
          logger.error('Streaming topic checkpoint could not be persisted.', error)
        })
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [activeRequestCount])

  useEffect(() => {
    /** Conversations whose requests finish while another topic is active. */
    const backgroundConversations = new Map<string, Conversation | Promise<Conversation | null>>()
    const backgroundSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const backgroundChains = new Map<string, Promise<void>>()

    /** Applies one stream event to a conversation object without touching the Redux topic. */
    const applyEventToConversation = (
      conversation: Conversation,
      event: ChatStreamEvent,
      messageId: string,
    ): Conversation => {
      /** Applies one immutable transform to the stream's target assistant message. */
      const mapMessage = (transform: (message: ChatMessage) => ChatMessage): Conversation => ({
        ...conversation,
        messages: conversation.messages.map((item) =>
          item.id === messageId ? transform(item) : item,
        ),
      })
      switch (event.type) {
        case 'searchProgress':
          return mapMessage((item) => {
            const queries = [...(item.searchQueries ?? [])]
            const idx = queries.findIndex((q) => q.query === event.query)
            const entry = {
              query: event.query,
              engine: event.engine,
              count: event.count,
              done: event.done,
            }
            if (idx >= 0) queries[idx] = entry
            else queries.push(entry)
            return { ...item, searchQueries: queries }
          })
        case 'title':
          return { ...conversation, title: event.title, isDefaultTitle: false }
        case 'complete': {
          const target = conversation.messages.find((item) => item.id === messageId)
          if (target && !target.content && !target.reasoning) {
            return {
              ...conversation,
              messages: conversation.messages.filter((item) => item.id !== messageId),
            }
          }
          return mapMessage((item) => freezeDuration({ ...item, status: 'complete' as const }))
        }
        case 'error':
          return mapMessage((item) =>
            freezeDuration({
              ...item,
              status: 'error',
              error: event.message || t('chat.requestFailed'),
            }),
          )
        case 'content': {
          const target = conversation.messages.find((item) => item.id === messageId)
          if (!target) return conversation
          return mapMessage((item) => ({
            ...item,
            content: event.replace ? event.delta : item.content + event.delta,
          }))
        }
        case 'reasoning': {
          const target = conversation.messages.find((item) => item.id === messageId)
          if (!target) return conversation
          return mapMessage((item) => ({
            ...item,
            reasoning: (item.reasoning ?? '') + event.delta,
            reasoningStartedAt: item.reasoningStartedAt ?? Date.now(),
          }))
        }
        case 'citations': {
          const filtered = event.citations.filter((c) => {
            const title = c.title.toLowerCase()
            return (
              title !== 'terms of service' && title !== 'learn more' && !title.startsWith('google')
            )
          })
          return mapMessage((item) => ({ ...item, citations: filtered }))
        }
        case 'usage':
          return mapMessage((item) => ({ ...item, usage: event.usage }))
        default:
          return conversation
      }
    }

    /** Persists stream updates for a topic that is no longer the active one. */
    const applyToBackgroundConversation = (
      conversationId: string,
      event: ChatStreamEvent,
      messageId: string,
    ): void => {
      const chain = (backgroundChains.get(conversationId) ?? Promise.resolve()).then(async () => {
        let entry = backgroundConversations.get(conversationId)
        if (entry === undefined) {
          const pending = window.app.getConversation(conversationId).catch(() => null)
          backgroundConversations.set(conversationId, pending)
          entry = pending
        }
        const loaded = await entry
        if (!loaded) return
        const next = {
          ...applyEventToConversation(loaded, event, messageId),
          updatedAt: new Date().toISOString(),
        }
        backgroundConversations.set(conversationId, next)
        if (event.type === 'title') {
          dispatch(replaceConversationSummary(toConversationSummary(next)))
        }
        if (event.type === 'complete' || event.type === 'error') {
          const timer = backgroundSaveTimers.get(conversationId)
          if (timer) window.clearTimeout(timer)
          backgroundSaveTimers.delete(conversationId)
          backgroundConversations.delete(conversationId)
          void window.app.saveConversation(next).catch((error: unknown) => {
            logger.error('Background topic could not be persisted.', error)
          })
          return
        }
        if (
          event.type === 'searchProgress' ||
          event.type === 'citations' ||
          event.type === 'usage'
        ) {
          void window.app.saveConversation(next).catch((error: unknown) => {
            logger.error('Background topic could not be persisted.', error)
          })
          return
        }
        const existing = backgroundSaveTimers.get(conversationId)
        if (existing) window.clearTimeout(existing)
        backgroundSaveTimers.set(
          conversationId,
          window.setTimeout(() => {
            backgroundSaveTimers.delete(conversationId)
            const latest = backgroundConversations.get(conversationId)
            if (!latest || latest instanceof Promise) return
            void window.app.saveConversation(latest).catch((error: unknown) => {
              logger.error('Background topic could not be persisted.', error)
            })
          }, 300),
        )
      })
      backgroundChains.set(
        conversationId,
        chain.catch((error: unknown) => {
          logger.error('Background stream could not be applied.', error)
        }),
      )
    }

    /** Applies a stream delta only when its originating topic is still active. */
    const unsubscribe = window.app.onChatStream((event) => {
      if (event.type === 'status' && event.status === 'generating-title') {
        if (event.conversationId) dispatch(setTitleGeneratingConversationId(event.conversationId))
        return
      }
      if (event.type === 'status' && event.status === 'title-done') {
        dispatch(setTitleGeneratingConversationId(null))
        return
      }
      if (event.type === 'title') {
        dispatch(setTitleGeneratingConversationId(null))
        const conversationId = event.conversationId ?? currentConversation?.id
        if (conversationId) {
          dispatch(
            replaceConversationSummary({
              ...toConversationSummary({
                id: conversationId,
                title: event.title,
                isDefaultTitle: false,
                updatedAt: new Date().toISOString(),
              } as Conversation),
              id: conversationId,
            }),
          )
          if (conversationRef.current?.id === conversationId) {
            updateConversation((conversation) => ({
              ...conversation,
              title: event.title,
              isDefaultTitle: false,
            }))
          }
        }
        return
      }
      const resumedBatch =
        'assistantMessageId' in event && event.conversationId && event.assistantMessageId
          ? { conversationId: event.conversationId, messageId: event.assistantMessageId }
          : undefined
      const active = activeRequests.current.get(event.requestId) ?? resumedBatch
      if (!active) return
      if (event.type === 'status') {
        return
      }
      if (event.type === 'complete' || event.type === 'error') {
        flushPendingDeltas()
        activeRequests.current.delete(event.requestId)
        syncConversationGeneratingState(active.conversationId)
      }
      if (conversationRef.current?.id !== active.conversationId) {
        applyToBackgroundConversation(active.conversationId, event, active.messageId)
        return
      }
      if (event.type === 'searchProgress') {
        updateMessage(active.messageId, (item) => {
          const queries = [...(item.searchQueries ?? [])]
          const idx = queries.findIndex((q) => q.query === event.query)
          const entry = {
            query: event.query,
            engine: event.engine,
            count: event.count,
            done: event.done,
          }
          if (idx >= 0) queries[idx] = entry
          else queries.push(entry)
          return { ...item, searchQueries: queries }
        })
        return
      }
      if (event.type === 'complete') {
        updateConversation((conversation) => {
          const target = conversation.messages.find((item) => item.id === active.messageId)
          if (target && !target.content && !target.reasoning) {
            return {
              ...conversation,
              messages: conversation.messages.filter((item) => item.id !== active.messageId),
            }
          }
          return {
            ...conversation,
            messages: conversation.messages.map((item) =>
              item.id === active.messageId
                ? freezeDuration({ ...item, status: 'complete' as const })
                : item,
            ),
          }
        })
        return
      }
      if (event.type === 'error') {
        logger.error('Provider request failed.', event.message)
        updateMessage(active.messageId, (item) =>
          freezeDuration({
            ...item,
            status: 'error',
            error: event.message || t('chat.requestFailed'),
          }),
        )
        return
      }
      if (event.type === 'content') {
        if (event.replace) {
          flushPendingDeltas()
          updateMessage(active.messageId, (item) => ({ ...item, content: event.delta }))
        } else {
          queueStreamDelta(active.messageId, { content: event.delta })
        }
      } else if (event.type === 'reasoning') {
        queueStreamDelta(active.messageId, { reasoning: event.delta })
      } else if (event.type === 'citations') {
        const filtered = event.citations.filter((c) => {
          const title = c.title.toLowerCase()
          return (
            title !== 'terms of service' && title !== 'learn more' && !title.startsWith('google')
          )
        })
        updateMessage(active.messageId, (item) => ({ ...item, citations: filtered }))
      } else if (event.type === 'usage') {
        updateMessage(active.messageId, (item) => ({ ...item, usage: event.usage }))
      }
    })
    return () => {
      unsubscribe()
      for (const timer of backgroundSaveTimers.values()) window.clearTimeout(timer)
      backgroundSaveTimers.clear()
      if (deltaFlushTimerRef.current) window.clearTimeout(deltaFlushTimerRef.current)
      deltaFlushTimerRef.current = null
    }
  }, [
    currentConversation?.id,
    dispatch,
    flushPendingDeltas,
    queueStreamDelta,
    syncConversationGeneratingState,
    t,
    updateMessage,
    updateConversation,
  ])

  const selectedModel = currentConversation?.selectedModel ?? snapshot.lastUsedModel
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const selectedDescriptor = snapshot.models.find(
    (model) =>
      selectedModel !== null &&
      model.providerId === selectedModel.providerId &&
      model.modelId === selectedModel.modelId,
  )
  const imageDescriptor = snapshot.models.find(
    (model) =>
      model.capabilities.imageGeneration &&
      selectedModel !== null &&
      model.providerId === selectedModel.providerId,
  )
  const selectedProvider = snapshot.providers.find(
    (provider) => provider.id === selectedDescriptor?.providerId,
  )
  const reasoningOptions = getProviderReasoningEfforts(
    selectedProvider?.type,
    selectedDescriptor?.reasoningEfforts,
  )
  const activeReasoningEffort = reasoningOptions.includes(
    currentConversation?.reasoningEffort ?? 'default',
  )
    ? (currentConversation?.reasoningEffort ?? 'default')
    : 'default'
  const modelNames = useMemo(
    () => new Map(snapshot.models.map((model) => [modelReferenceKey(model), model.name])),
    [snapshot.models],
  )
  const providerNames = useMemo(
    () => new Map(snapshot.providers.map((provider) => [provider.id, provider.name])),
    [snapshot.providers],
  )
  const visibleMessages = (currentConversation?.messages ?? []).filter(
    (item) => item.role === 'user' || item.role === 'assistant',
  )
  const timelineGroups: ChatMessage[][] = []
  for (const item of visibleMessages) {
    const previousGroup = timelineGroups.at(-1)
    if (item.role === 'assistant' && previousGroup?.at(-1)?.role === 'assistant')
      previousGroup.push(item)
    else timelineGroups.push([item])
  }

  /** Persists the topic selection and remembers it for every subsequently created chat. */
  const selectModel = async (model: ModelReference | null): Promise<void> => {
    updateConversation((conversation) => ({ ...conversation, selectedModel: model }))
    setImageGeneration(false)
    if (!model) return
    try {
      dispatch(setProviders(await window.app.setLastUsedModel(model)))
    } catch (error) {
      logger.error('Last-used chat model could not be saved.', error)
      void message.error(t('errors.generic'))
    }
  }

  /** Toggles a favorite and refreshes every picker from the returned snapshot. */
  const toggleFavorite = async (model: ModelReference, favorite: boolean): Promise<void> => {
    try {
      dispatch(setProviders(await window.app.setFavoriteModel(model, favorite)))
    } catch (error) {
      logger.error('Favorite model could not be changed.', error)
      void message.error(t('errors.generic'))
    }
  }

  /** Updates web-search state while retaining the last selected engine when switched off. */
  const selectWebSearch = (value: WebSearchMode): void => {
    updateConversation((conversation) => ({
      ...conversation,
      searchMode: value,
      lastSearchEngine: value === 'off' ? conversation.lastSearchEngine : value,
    }))
  }

  /** Updates whether zero-result searches fall back to the remaining engines. */
  const selectWebSearchFallback = (value: boolean): void => {
    updateConversation((conversation) => ({ ...conversation, useWebSearchFallback: value }))
  }

  /** Opens the native picker and appends validated attachment copies to the draft. */
  const selectAttachments = async (): Promise<void> => {
    const conversation = conversationRef.current
    if (!conversation) return
    try {
      const selected = await window.app.selectAttachments(conversation.id)
      if (selected.length === 0) return
      setAttachments((items) => [...items, ...selected].slice(0, MAX_ATTACHMENTS))
    } catch (error) {
      logger.error('Attachments could not be prepared.', error)
      void message.error(t('chat.attachmentFailed'))
    }
  }

  /**
   * Moves an oversized paste into a text attachment. Keeping it out of the
   * composer value is what stops the auto-sizing textarea from re-measuring a
   * huge string on every keystroke and stops the message body from being handed
   * to the Markdown renderer as one enormous inline block.
   */
  const attachPastedText = async (text: string): Promise<void> => {
    const conversation = conversationRef.current
    if (!conversation) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      void message.warning(t('chat.attachmentLimitReached', { count: MAX_ATTACHMENTS }))
      return
    }
    const clamped = clampText(text, MAX_PASTED_TEXT_CHARACTERS)
    try {
      const attachment = await window.app.createTextAttachment(conversation.id, clamped)
      setAttachments((items) => [...items, attachment].slice(0, MAX_ATTACHMENTS))
      void message.success(
        t('chat.pastedTextAttached', { characters: formatCharacterCount(clamped.length) }),
      )
      if (clamped.length < text.length) {
        void message.warning(
          t('chat.pastedTextTruncated', {
            characters: formatCharacterCount(MAX_PASTED_TEXT_CHARACTERS),
          }),
        )
      }
    } catch (error) {
      logger.error('Pasted text could not be attached.', error)
      void message.error(t('chat.attachmentFailed'))
    }
  }

  /** Starts one independent model completion for an existing message history. */
  const startCompletion = async (
    history: ChatMessage[],
    model: ModelReference,
    useImageGeneration: boolean,
    displayedHistory: ChatMessage[] = history,
  ): Promise<void> => {
    const conversation = conversationRef.current
    if (!conversation) return
    const requestDescriptor = snapshot.models.find(
      (item) => item.providerId === model.providerId && item.modelId === model.modelId,
    )
    const requestProvider = snapshot.providers.find((item) => item.id === model.providerId)
    const requestReasoningOptions = getProviderReasoningEfforts(
      requestProvider?.type,
      requestDescriptor?.reasoningEfforts,
    )
    const requestReasoningEffort = requestReasoningOptions.includes(conversation.reasoningEffort)
      ? conversation.reasoningEffort
      : 'default'
    const assistant = { ...createMessage('assistant', '', 'streaming'), model }
    updateConversation((value) => ({ ...value, messages: [...displayedHistory, assistant] }))
    const requestId = crypto.randomUUID()
    activeRequests.current.set(requestId, {
      messageId: assistant.id,
      conversationId: conversation.id,
    })
    dispatch(setConversationGenerating({ conversationId: conversation.id, generating: true }))
    const request: ChatRequest = {
      requestId,
      conversationId: conversation.id,
      assistantMessageId: assistant.id,
      model,
      messages: history,
      searchMode: conversation.searchMode,
      useWebSearchFallback: conversation.useWebSearchFallback,
      reasoningEffort: requestReasoningEffort,
      imageGeneration: useImageGeneration,
    }
    void window.app.startChat(request).catch((error: unknown) => {
      logger.error('Chat request could not be started.', error)
      activeRequests.current.delete(requestId)
      syncConversationGeneratingState(conversation.id)
      updateMessage(assistant.id, (item) =>
        freezeDuration({
          ...item,
          status: 'error',
          error: t('chat.requestFailed'),
        }),
      )
    })
  }

  /** Adds the draft as a user message and starts the selected model. */
  const sendDraft = async (): Promise<void> => {
    const conversation = conversationRef.current
    const content = draft.trim()
    if (!conversation || (!content && attachments.length === 0) || activeRequestCount > 0) return
    const model =
      imageGeneration && imageDescriptor ? toModelReference(imageDescriptor) : selectedModel
    if (!model) {
      void message.warning(t('chat.selectModelFirst'))
      return
    }
    const user = {
      ...createMessage('user', content),
      tokenCount: estimateTextTokens(
        [content, ...attachments.map((attachment) => attachment.extractedText ?? '')].join('\n'),
      ),
      ...(attachments.length ? { attachments } : {}),
    }
    const history = [...conversation.messages, user]
    setDraft('')
    setAttachments([])
    inputHistory.saveHistory(content)
    await startCompletion(history, model, imageGeneration)
  }

  /** Stops every active completion and retains partial response text. */
  const stopAll = useCallback(async (): Promise<void> => {
    const entries = [...activeRequests.current.entries()]
    activeRequests.current.clear()
    const conversationIds = [...new Set(entries.map(([, active]) => active.conversationId))]
    conversationIds.forEach(syncConversationGeneratingState)
    await Promise.all(entries.map(([requestId]) => window.app.stopChat(requestId)))
    updateConversation((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((item) =>
        entries.some(([, active]) => active.messageId === item.id)
          ? freezeDuration({ ...item, status: 'stopped' as const })
          : item,
      ),
    }))
  }, [syncConversationGeneratingState, updateConversation])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || activeRequestCount === 0) return

    /** Stops the active completion when Escape is pressed anywhere in the chat workspace. */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void stopAll()
    }

    workspace.addEventListener('keydown', onKeyDown)
    return () => workspace.removeEventListener('keydown', onKeyDown)
  }, [activeRequestCount, stopAll])

  /** Confirms and restarts one assistant response with its original model. */
  const regenerate = (messageId: string): void => {
    const conversation = conversationRef.current
    if (!conversation) return
    const index = conversation.messages.findIndex((item) => item.id === messageId)
    const target = conversation.messages[index]
    if (index < 0 || !target?.model) return
    const targetModel = target.model
    modal.confirm({
      title: t('chat.regenerateTitle'),
      content: t('chat.regenerateDescription'),
      okText: t('chat.regenerate'),
      cancelText: t('common.cancel'),
      /** Restarts completion with the chosen replacement model after confirmation. */
      onOk: () => startCompletion(conversation.messages.slice(0, index), targetModel, false),
    })
  }

  /** Moves a user message back into the editor and removes later dependent responses. */
  const editMessage = (messageId: string): void => {
    const conversation = conversationRef.current
    if (!conversation) return
    const index = conversation.messages.findIndex((item) => item.id === messageId)
    const target = conversation.messages[index]
    if (target?.role !== 'user') return
    setDraft(target.content)
    setAttachments(target.attachments ?? [])
    updateConversation((value) => ({ ...value, messages: value.messages.slice(0, index) }))
  }

  /** Creates a new local branch containing messages through the selected point. */
  const createBranch = async (messageId: string): Promise<void> => {
    const conversation = conversationRef.current
    if (!conversation) return
    const index = conversation.messages.findIndex((item) => item.id === messageId)
    if (index < 0) return
    try {
      const created = await window.app.createConversation()
      const branch = await window.app.saveConversation({
        ...created,
        title: `${conversation.title} · ${t('chat.branch')}`.slice(0, 200),
        isDefaultTitle: false,
        messages: conversation.messages.slice(0, index + 1),
        selectedModel: conversation.selectedModel,
        searchMode: conversation.searchMode,
        lastSearchEngine: conversation.lastSearchEngine,
        useWebSearchFallback: conversation.useWebSearchFallback,
        reasoningEffort: conversation.reasoningEffort,
      })
      dispatch(addConversationSummary(toConversationSummary(branch)))
      dispatch(setCurrentConversation(branch))
    } catch (error) {
      logger.error('Chat branch could not be created.', error)
      void message.error(t('errors.generic'))
    }
  }

  /** Opens a single-model picker for an alternate response to one assistant turn. */
  const openAlternateModel = (messageId: string): void => {
    setAlternateTargetId(messageId)
    setAlternateModel(selectedModelRef.current)
  }

  /** Starts one alternate response with the model selected in the dialog. */
  const applyAlternateModel = (): void => {
    const conversation = conversationRef.current
    if (!conversation || !alternateTargetId || !alternateModel) return
    const index = conversation.messages.findIndex((item) => item.id === alternateTargetId)
    if (index < 0) return
    void startCompletion(
      conversation.messages.slice(0, index),
      alternateModel,
      false,
      conversation.messages.slice(0, index + 1),
    )
    setAlternateTargetId(null)
    setAlternateModel(null)
  }

  /** Renders one regular message with actions bound to the active topic. */
  const renderMessage = (item: ChatMessage): React.JSX.Element => (
    <MessageBubble
      key={item.id}
      message={item}
      expanded={expanded}
      modelLabel={
        item.model
          ? `${modelNames.get(modelReferenceKey(item.model)) ?? item.model.modelId} | ${providerNames.get(item.model.providerId) ?? item.model.providerId}`
          : ''
      }
      onEdit={() => editMessage(item.id)}
      onRegenerate={() => regenerate(item.id)}
      onAnotherModel={() => openAlternateModel(item.id)}
      onDelete={() =>
        updateConversation((conversation) => {
          const remaining = conversation.messages.filter(
            (messageItem) => messageItem.id !== item.id,
          )
          if (remaining.length > 0) return { ...conversation, messages: remaining }
          return { ...conversation, messages: [createMessage('assistant', '', 'complete')] }
        })
      }
      onBranch={() => void createBranch(item.id)}
    />
  )

  if (!currentConversation) return <div className={styles.empty}>{t('chat.noTopic')}</div>

  return (
    <section ref={workspaceRef} className={styles.workspace}>
      <header className={styles.topbar}>
        <div className={`${styles.topbarContent} ${expanded ? '' : styles.centeredTopbar}`}>
          <ModelSelect
            className={styles.modelSelect ?? ''}
            models={snapshot.models}
            providers={snapshot.providers}
            value={selectedModel}
            onChange={(model) => void selectModel(model)}
            onFavorite={(model, favorite) => void toggleFavorite(model, favorite)}
          />
          <span className={styles.topbarSpacer} />
          <Tooltip title={expanded ? t('chat.collapseDialog') : t('chat.expandDialog')}>
            <Button
              type="text"
              icon={expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              onClick={onToggleExpanded}
            />
          </Tooltip>
        </div>
      </header>
      <div
        ref={timelineRef}
        className={`${styles.timeline} ${expanded ? '' : styles.centeredTimeline}`}
      >
        {visibleMessages.length === 0 ? (
          <div className={styles.welcome}>
            <div>
              <MessageSquarePlus size={26} />
            </div>
            <h2>{t('chat.welcome')}</h2>
            <p>
              {snapshot.models.length === 0
                ? t('chat.configureProvider')
                : t('chat.startConversation')}
            </p>
          </div>
        ) : (
          timelineGroups.map((group) => {
            const first = group[0]
            if (!first) return null
            return group.length > 1 ? (
              <div className={styles.parallel} key={group.map((item) => item.id).join(':')}>
                {group.map(renderMessage)}
              </div>
            ) : (
              renderMessage(first)
            )
          })
        )}
      </div>
      <div className={`${styles.composerWrap} ${expanded ? '' : styles.centeredComposer}`}>
        {attachments.length > 0 && (
          <div className={styles.draftChips}>
            {attachments.map((attachment) => (
              <span key={attachment.id}>
                {attachment.name}
                {attachment.kind === 'text' && attachment.extractedText ? (
                  <em className={styles.chipMeta}>
                    {t('chat.attachmentCharacters', {
                      characters: formatCharacterCount(attachment.extractedText.length),
                    })}
                  </em>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((items) => items.filter((item) => item.id !== attachment.id))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <Input.TextArea
          ref={inputRef}
          className={styles.input ?? ''}
          value={draft}
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder={t('chat.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text/plain')
            if (!shouldAttachPastedText(pasted)) return
            event.preventDefault()
            void attachPastedText(pasted)
          }}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229 || isComposingRef.current) {
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendDraft()
              return
            }

            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            const textArea = inputRef.current?.resizableTextArea?.textArea
            const isAllSelected =
              !!textArea &&
              textArea.selectionStart === 0 &&
              textArea.selectionEnd === textArea.value.length
            const isCursorAtEnd = !!textArea && textArea.selectionEnd === textArea.value.length
            if (
              !shouldHandleInputHistoryNavigation({
                isAllSelected,
                isComposing: isComposingRef.current,
                isCursorAtEnd,
                key: event.key,
                text: draft,
              })
            ) {
              return
            }
            event.preventDefault()
            if (inputHistory.navigateHistory(event.key === 'ArrowUp' ? 'up' : 'down', draft)) {
              requestAnimationFrame(() => {
                const area = inputRef.current?.resizableTextArea?.textArea
                if (area) {
                  const position = area.value.length
                  area.setSelectionRange(position, position)
                }
              })
            }
          }}
        />
        <div className={styles.tools}>
          <Tooltip title={t('conversations.newConversation')}>
            <Button
              type="text"
              icon={<MessageSquarePlus size={17} />}
              onClick={() => void conversationActions.createConversation()}
            />
          </Tooltip>
          <Tooltip title={t('chat.attachment')}>
            <Button
              type="text"
              icon={<Paperclip size={17} />}
              onClick={() => void selectAttachments()}
            />
          </Tooltip>
          {selectedDescriptor && reasoningOptions.length > 0 && (
            <ReasoningControl
              options={reasoningOptions}
              value={activeReasoningEffort}
              onChange={(reasoningEffort) =>
                updateConversation((conversation) => ({ ...conversation, reasoningEffort }))
              }
            />
          )}
          <WebSearchControl
            value={currentConversation.searchMode}
            onChange={selectWebSearch}
            useWebSearchFallback={currentConversation.useWebSearchFallback}
            onWebSearchFallbackChange={selectWebSearchFallback}
          />
          {imageDescriptor && (
            <Tooltip title={t('chat.imageGeneration')}>
              <Button
                type="text"
                className={imageGeneration ? (styles.activeTool ?? '') : ''}
                icon={<Image size={17} />}
                onClick={() => setImageGeneration((value) => !value)}
              />
            </Tooltip>
          )}
          <Tooltip title={t('chat.clearTopic')}>
            <Button
              type="text"
              icon={<Eraser size={17} />}
              onClick={() =>
                updateConversation((conversation) => ({ ...conversation, messages: [] }))
              }
            />
          </Tooltip>
          <span className={styles.toolSpacer} />
          {activeRequestCount > 0 ? (
            <Tooltip title={t('chat.stop')}>
              <Button
                type="text"
                danger
                className={styles.sendButton ?? ''}
                aria-label={t('chat.stop')}
                icon={<Square size={17} fill="currentColor" />}
                onClick={() => void stopAll()}
              />
            </Tooltip>
          ) : (
            <Tooltip title={t('chat.send')}>
              <Button
                type="text"
                className={styles.sendButton ?? ''}
                aria-label={t('chat.send')}
                icon={<Send size={21} />}
                disabled={!draft.trim() && attachments.length === 0}
                onClick={() => void sendDraft()}
              />
            </Tooltip>
          )}
        </div>
      </div>
      <Modal
        title={t('chat.anotherModel')}
        open={alternateTargetId !== null}
        okText={t('common.apply')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: alternateModel === null }}
        onOk={applyAlternateModel}
        onCancel={() => {
          setAlternateTargetId(null)
          setAlternateModel(null)
        }}
        destroyOnHidden
      >
        <ModelSelect
          className={styles.modalModelSelect ?? ''}
          models={snapshot.models}
          providers={snapshot.providers}
          value={alternateModel}
          onChange={setAlternateModel}
          onFavorite={(model, favorite) => void toggleFavorite(model, favorite)}
        />
      </Modal>
    </section>
  )
}

export default ChatWorkspace
