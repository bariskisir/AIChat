/** Orchestrates multi-type chat streaming: OpenAI-compatible, ChatGPT, and Claude Web. */

import { randomUUID } from 'node:crypto'
import { clampSurrogateBoundary } from '@shared/index'
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ModelReference,
  WebSearchMode,
} from '@shared/index'
import { buildReasoningParameters } from '../reasoning/index'
import { isKimi25OrNewerModel } from '../reasoning/families/chinese'
import type LoggerService from '../logging/logger.service'
import type { ProviderRegistry } from '../providers/index'
import { normalizeOpenAiBaseUrl } from '../providers/openai-compatible/openai-compatible.base-url'
import type { ChatGptAuth, ClaudeWebAuth } from '../providers/index'
import {
  buildResponsesRequest,
  CHATGPT_RESPONSES_URL,
  parseResponsesSseLine,
  extractResponsesText,
} from '../providers/chatgpt/chatgpt.protocol'
import {
  buildClaudePrompt,
  ClaudeStreamAccumulator,
  resolveClaudeThinking,
} from '../providers/claude-web/claude-web.protocol'
import type StorageService from '../persistence/storage.service'
import type { PersistedBatchJob } from '../persistence/storage.service'
import type { WebSearchResult } from '../search/web.search.service'
import WebSearchService from '../search/web.search.service'
import { createProviderError, parseTokenUsage, readReasoningDelta } from './chat.errors'
import { buildTitlePrompt, fallbackTitle, sanitizeTitle } from './title.generator'

type Emit = (event: ChatStreamEvent) => void

/** Reasoning-effort used by internal one-shot Quick Model calls, which never need thinking. */
const UTILITY_REASONING_EFFORT = 'off' as const

/** Allows newly-created batch jobs time to become visible to distributed status endpoints. */
const MAX_BATCH_NOT_FOUND_RETRIES = 6

/** Removes a batch routing suffix from the model sent inside a batch job. */
const batchModelId = (modelId: string): string => modelId.replace(/:batch$/i, '')

/** Narrows an unknown JSON value to a non-array record. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Extracts response text from common OpenAI-compatible message content shapes. */
const readBatchContent = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .flatMap((item) => {
      if (!isRecord(item)) return []
      if (typeof item.text === 'string') return [item.text]
      if (typeof item.content === 'string') return [item.content]
      return []
    })
    .join('')
}

/** Reads a human-safe batch failure message from a provider result. */
const readBatchError = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return 'The batch request failed.'
  if (typeof value.message === 'string' && value.message.trim()) return value.message.trim()
  if (isRecord(value.error)) return readBatchError(value.error)
  return 'The batch request failed.'
}

/** Removes every provider reasoning key so a rejected body can be retried without thinking. */
const stripReasoningParameters = (body: Record<string, unknown>): void => {
  delete body.thinking
  delete body.enable_thinking
  delete body.reasoning_effort
  delete body.reasoning
  delete body.disable_reasoning
  delete body.chat_template_kwargs
  delete body.thinking_budget
  delete body.extra_body
  delete body.incremental_output
}

interface CompatibleMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
  reasoning_content?: string
}

/** Holds the OpenAI-compatible provider fields needed to make completion requests. */
interface CompatibleProvider {
  id: string
  name: string
  baseUrl: string
  batchUrl?: string | undefined
  batchPollIntervalSeconds?: number | undefined
  batchModelRegex?: string | undefined
  customHeaders?: Record<string, string> | undefined
}

/** Supplies durable conversation context for one user-visible batch request. */
interface BatchRequestContext {
  requestId: string
  conversationId: string
  assistantMessageId: string
  model: ModelReference
  messages: ChatMessage[]
}

/** Resolves or rejects the chat request that is awaiting one queued batch job. */
interface BatchWaiter {
  resolve: () => void
  reject: (error: Error) => void
  cleanup: () => void
}

/** Reference prompt that teaches models to cite search sources with [number]. */
const REFERENCE_PROMPT = `Please answer the question based on the reference materials

## Citation Rules:
- Please cite the context at the end of sentences when appropriate.
- Please use the format of citation number [number] to reference the context in corresponding parts of your answer.
- If a sentence comes from multiple contexts, please list all relevant citation numbers, e.g., [1][2]. Remember not to group citations at the end but list them in the corresponding parts of your answer.
- If all reference content is not relevant to the user's question, please answer based on your knowledge.

## My question is:

{question}

## Reference Materials:

{references}

Please respond in the same language as the user's question.`

/** Owns active completion cancellation and streams provider output back to the renderer. */
export default class ChatService {
  private readonly active = new Map<string, AbortController>()
  private readonly webSearch: WebSearchService
  private readonly compatibleEndpointCache = new Map<string, 'chat' | 'responses'>()
  private readonly activeBatchPolls = new Set<string>()
  private readonly batchPollControllers = new Map<string, AbortController>()
  private readonly batchWaiters = new Map<string, BatchWaiter>()
  private batchPollIntervalMs = 30_000
  private batchQueueTimer: ReturnType<typeof setInterval> | null = null
  private batchEmitter: Emit | null = null
  private readonly logger: LoggerService

  /** Creates a chat orchestrator from provider, auth, storage, logging, and web-search services. */
  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly chatgpt: ChatGptAuth,
    private readonly claude: ClaudeWebAuth,
    private readonly storage: StorageService,
    logger: LoggerService,
  ) {
    this.logger = logger
    this.webSearch = new WebSearchService(logger)
  }

  /** Produces an in-memory cache key for one OpenAI-compatible model endpoint choice. */
  private compatibleCacheKey(providerId: string, modelId: string): string {
    return `${providerId}\u0000${modelId}`
  }

  /** Starts the durable batch worker and immediately checks jobs recovered from a prior launch. */
  public async startBatchQueue(emit: Emit): Promise<void> {
    this.batchEmitter = emit
    this.refreshBatchQueue()
    if (!this.batchQueueTimer) this.startBatchQueueTimer()
    await this.pollQueuedBatches()
  }

  /** Refreshes the durable queue cadence from the saved OpenRouter provider configuration. */
  public refreshBatchQueue(): void {
    const openrouter = this.providers
      .snapshot()
      .providers.find((provider) => provider.id === 'openrouter')
    this.batchPollIntervalMs = (openrouter?.batchPollIntervalSeconds ?? 30) * 1000
    if (!this.batchQueueTimer) return
    clearInterval(this.batchQueueTimer)
    this.startBatchQueueTimer()
  }

  /** Starts the queue interval with the current batch-poll preference. */
  private startBatchQueueTimer(): void {
    this.batchQueueTimer = setInterval(() => {
      void this.pollQueuedBatches()
    }, this.batchPollIntervalMs)
  }

  /** Tests an OpenRouter model identifier against its case-insensitive batch routing expression. */
  private isBatchModel(provider: CompatibleProvider, modelId: string): boolean {
    if (provider.id !== 'openrouter') return false
    return new RegExp(provider.batchModelRegex ?? 'batch', 'i').test(modelId)
  }

  /** Lists conversations with an outstanding batch so bootstrap can restore their generating state. */
  public async getQueuedBatchConversationIds(): Promise<string[]> {
    return [...new Set((await this.storage.listBatchJobs()).map((job) => job.conversationId))]
  }

  /** Stops this window-bound worker while leaving submitted batch jobs durable for the next window. */
  public dispose(): void {
    if (this.batchQueueTimer) clearInterval(this.batchQueueTimer)
    this.batchQueueTimer = null
    this.batchEmitter = null
    for (const controller of this.batchPollControllers.values()) controller.abort()
    this.batchPollControllers.clear()
  }

  /** Runs one request and emits isolated incremental events until completion or failure. */
  public async start(request: ChatRequest, emit: Emit): Promise<void> {
    if (this.active.has(request.requestId)) throw new Error('This request is already active.')
    const controller = new AbortController()
    this.active.set(request.requestId, controller)
    try {
      const titleWasDefault = await this.assignTitleFromFirstMessage(request, emit)
      const titlePromise = titleWasDefault ? this.generateTitle(request, emit) : Promise.resolve()
      if (request.imageGeneration) {
        emit({ requestId: request.requestId, type: 'status', status: 'generating' })
        await this.generateImage(request, controller.signal, emit)
      } else {
        await this.generateChat(request, controller.signal, emit)
      }
      if (!controller.signal.aborted) {
        emit({ requestId: request.requestId, type: 'complete' })
        await titlePromise
      }
    } catch (error) {
      if (controller.signal.aborted) return
      emit({
        requestId: request.requestId,
        type: 'error',
        message: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      this.active.delete(request.requestId)
    }
  }

  /** Names the first chat from its first user message and reports whether a rename happened. */
  private async assignTitleFromFirstMessage(request: ChatRequest, emit: Emit): Promise<boolean> {
    const conversation = await this.storage.getConversation(request.conversationId)
    const userMessages = request.messages.filter((message) => message.role === 'user')
    if (!conversation.isDefaultTitle || userMessages.length !== 1) return false
    const title = fallbackTitle(userMessages[0]?.content ?? '')
    await this.storage.renameConversation(request.conversationId, title)
    emit({
      requestId: request.requestId,
      type: 'title',
      title,
      conversationId: request.conversationId,
    })
    return true
  }

  /** Refines the fallback title with the Quick Model in parallel with the answer stream. */
  private async generateTitle(request: ChatRequest, emit: Emit): Promise<void> {
    const { quickModel, titleGenerationEnabled } = this.providers.snapshot()
    if (!titleGenerationEnabled || !quickModel) return
    const userText = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join(' ')
      .trim()
    if (!userText) return
    const firstUserContent =
      request.messages.find((message) => message.role === 'user')?.content ?? ''
    try {
      // A manual rename while the title is being generated must win over it.
      const conversation = await this.storage.getConversation(request.conversationId)
      if (conversation.title !== fallbackTitle(firstUserContent)) return
      emit({
        requestId: request.requestId,
        type: 'status',
        status: 'generating-title',
        conversationId: request.conversationId,
      })
      const settings = await this.storage.loadSettings()
      const content = await this.completeOnce(
        quickModel,
        [
          { role: 'system', content: buildTitlePrompt(settings.language) },
          {
            role: 'user',
            content: JSON.stringify({
              role: 'user',
              mainText: userText.slice(0, clampSurrogateBoundary(userText, 2_000)),
            }),
          },
        ],
        AbortSignal.timeout(30_000),
      )
      const title = sanitizeTitle(content)
      if (title) {
        await this.storage.renameConversation(request.conversationId, title)
        emit({
          requestId: request.requestId,
          type: 'title',
          title,
          conversationId: request.conversationId,
        })
      }
    } catch {
      // The fallback title stays when the Quick Model is unavailable.
    } finally {
      emit({
        requestId: request.requestId,
        type: 'status',
        status: 'title-done',
        conversationId: request.conversationId,
      })
    }
  }

  /** Aborts one active provider or web request without affecting other parallel models. */
  public stop(requestId: string): void {
    this.active.get(requestId)?.abort()
    this.active.delete(requestId)
    void this.abandonQueuedBatches(requestId)
  }

  /** Resolves optional web-search context and streams an OpenAI-compatible completion. */
  private async generateChat(request: ChatRequest, signal: AbortSignal, emit: Emit): Promise<void> {
    const prompt =
      [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    let searchResult: WebSearchResult | null = null
    if (request.searchMode !== 'off') {
      const queries = await this.generateSearchQueries(prompt, signal)
      const settings = await this.storage.loadSettings()
      searchResult = await this.webSearch.search(
        request.searchMode,
        queries,
        settings.language,
        request.useWebSearchFallback,
        signal,
        (query, engine, count, done) => {
          emit({
            requestId: request.requestId,
            type: 'searchProgress',
            query,
            engine: engine as Exclude<WebSearchMode, 'off'>,
            count,
            done,
          })
        },
      )
      emit({ requestId: request.requestId, type: 'citations', citations: searchResult.citations })
    }
    emit({ requestId: request.requestId, type: 'status', status: 'generating' })
    const messages = this.toCompatibleMessages(request.messages)
    if (searchResult?.context) {
      messages.unshift({
        role: 'system',
        content: this.buildReferencePrompt(prompt, searchResult),
      })
    }
    await this.streamCompletion(
      request.model,
      messages,
      request.reasoningEffort,
      signal,
      request.requestId,
      emit,
      {
        requestId: request.requestId,
        conversationId: request.conversationId,
        assistantMessageId: request.assistantMessageId,
        model: request.model,
        messages: request.messages,
      },
    )
  }

  /** Builds the reference prompt with JSON sources for [number] citations. */
  private buildReferencePrompt(question: string, result: WebSearchResult): string {
    const references = result.citations.map((citation) => ({
      number: citation.index,
      title: citation.title,
      content: citation.snippet,
      url: citation.url,
    }))
    return REFERENCE_PROMPT.replace('{question}', question).replace(
      '{references}',
      `\`\`\`json\n${JSON.stringify(references, null, 2)}\n\`\`\``,
    )
  }

  /** Calls the compatible image endpoint and returns a renderer-safe data URL. */
  private async generateImage(
    request: ChatRequest,
    signal: AbortSignal,
    emit: Emit,
  ): Promise<void> {
    const { provider, apiKey } = this.providers.resolve(request.model)
    const prompt = [...request.messages]
      .reverse()
      .find((message) => message.role === 'user')?.content
    if (!prompt) throw new Error('An image prompt is required.')
    if (provider.type !== 'openai-compatible')
      throw new Error('Image generation requires an OpenAI-compatible provider.')
    let response = await fetch(`${normalizeOpenAiBaseUrl(provider.baseUrl)}/images/generations`, {
      method: 'POST',
      headers: this.headers(apiKey, provider.customHeaders),
      body: JSON.stringify({ model: request.model.modelId, prompt, response_format: 'b64_json' }),
      signal,
    })
    if (!response.ok && response.status === 400) {
      await response.body?.cancel().catch(() => undefined)
      response = await fetch(`${normalizeOpenAiBaseUrl(provider.baseUrl)}/images/generations`, {
        method: 'POST',
        headers: this.headers(apiKey, provider.customHeaders),
        body: JSON.stringify({ model: request.model.modelId, prompt }),
        signal,
      })
    }
    if (!response.ok) throw await createProviderError(response)
    const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
    const image = payload.data?.[0]
    if (image?.b64_json) {
      emit({
        requestId: request.requestId,
        type: 'content',
        delta: `![Generated image](data:image/png;base64,${image.b64_json})`,
      })
      return
    }
    if (image?.url) {
      const imageResponse = await fetch(image.url, { signal })
      if (!imageResponse.ok) throw new Error('The generated image could not be downloaded.')
      const type = imageResponse.headers.get('content-type') || 'image/png'
      const base64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64')
      emit({
        requestId: request.requestId,
        type: 'content',
        delta: `![Generated image](data:${type};base64,${base64})`,
      })
      return
    }
    throw new Error('Provider returned no generated image.')
  }

  /** Streams one completion through the protocol family of the resolved provider. */
  private async streamCompletion(
    model: ModelReference,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    emit: Emit,
    batchContext: BatchRequestContext,
  ): Promise<void> {
    const { provider, apiKey, modelDefinition } = this.providers.resolve(model)
    if (provider.type === 'chatgpt') {
      await this.streamChatGptResponses(
        model.modelId,
        provider.id,
        messages,
        reasoningEffort,
        signal,
        requestId,
        emit,
      )
      return
    }
    if (provider.type === 'claude-web') {
      await this.streamClaudeWeb(
        model.modelId,
        provider.id,
        modelDefinition,
        messages,
        reasoningEffort,
        signal,
        requestId,
        emit,
      )
      return
    }
    await this.streamOpenAiCompatibleWithFallback(
      provider,
      apiKey,
      model.modelId,
      messages,
      reasoningEffort,
      signal,
      requestId,
      emit,
      batchContext,
    )
  }

  /** Streams one OpenAI-compatible completion, defaulting to chat and falling back to responses. */
  private async streamOpenAiCompatibleWithFallback(
    provider: CompatibleProvider,
    apiKey: string,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    emit: Emit,
    batchContext: BatchRequestContext,
  ): Promise<void> {
    if (provider.batchUrl && this.isBatchModel(provider, modelId)) {
      await this.streamOpenAiCompatibleBatch(
        provider,
        apiKey,
        modelId,
        messages,
        reasoningEffort,
        signal,
        requestId,
        emit,
        batchContext,
      )
      return
    }
    const key = this.compatibleCacheKey(provider.id, modelId)
    const preferred = this.compatibleEndpointCache.get(key)

    /** Attempts one streaming endpoint and records the successful choice in memory. */
    const tryResponsesFirst = async (): Promise<void> => {
      try {
        await this.streamOpenAiCompatibleResponses(
          provider,
          apiKey,
          modelId,
          messages,
          reasoningEffort,
          signal,
          requestId,
          emit,
        )
        this.compatibleEndpointCache.set(key, 'responses')
        this.logger.info('ChatService', `Cached responses endpoint for ${provider.id}/${modelId}`)
      } catch (error) {
        if (signal.aborted) throw error
        this.logger.warn(
          'ChatService',
          `Responses failed for ${provider.id}/${modelId}, trying chat.`,
          error,
        )
        await this.streamOpenAiCompatibleChat(
          provider,
          apiKey,
          modelId,
          messages,
          reasoningEffort,
          signal,
          requestId,
          emit,
        )
        this.compatibleEndpointCache.set(key, 'chat')
        this.logger.info('ChatService', `Cached chat endpoint for ${provider.id}/${modelId}`)
      }
    }

    /** Attempts chat first, then falls back to responses on any non-abort failure. */
    const tryChatFirst = async (): Promise<void> => {
      try {
        await this.streamOpenAiCompatibleChat(
          provider,
          apiKey,
          modelId,
          messages,
          reasoningEffort,
          signal,
          requestId,
          emit,
        )
        this.compatibleEndpointCache.set(key, 'chat')
      } catch (error) {
        if (signal.aborted) throw error
        this.logger.warn(
          'ChatService',
          `Chat completions failed for ${provider.id}/${modelId}, trying responses.`,
          error,
        )
        await this.streamOpenAiCompatibleResponses(
          provider,
          apiKey,
          modelId,
          messages,
          reasoningEffort,
          signal,
          requestId,
          emit,
        )
        this.compatibleEndpointCache.set(key, 'responses')
        this.logger.info('ChatService', `Cached responses endpoint for ${provider.id}/${modelId}`)
      }
    }

    if (preferred === 'responses') await tryResponsesFirst()
    else await tryChatFirst()
  }

  /** Streams one OpenAI-compatible chat completions request with 400/422 retries. */
  private async streamOpenAiCompatibleChat(
    provider: CompatibleProvider,
    apiKey: string,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    emit: Emit,
  ): Promise<void> {
    const reasoningParameters = buildReasoningParameters(modelId, reasoningEffort, {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
    })
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(reasoningParameters ?? {}),
    }
    const endpoint = `${normalizeOpenAiBaseUrl(provider.baseUrl)}/chat/completions`
    /** Sends the current compatible request body so unsupported usage options can be retried. */
    const sendRequest = (): Promise<Response> =>
      fetch(endpoint, {
        method: 'POST',
        headers: this.headers(apiKey, provider.customHeaders),
        body: JSON.stringify(body),
        signal,
      })
    let response = await sendRequest()
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      await response.body?.cancel()
      delete body.stream_options
      response = await sendRequest()
    }
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      await response.body?.cancel()
      stripReasoningParameters(body)
      response = await sendRequest()
    }
    if (!response.ok) throw await createProviderError(response)
    await this.readSseStream(response, (line) => this.emitSseLine(line, requestId, emit))
  }

  /** Streams one OpenAI-compatible responses request and emits via the shared Responses parser. */
  private async streamOpenAiCompatibleResponses(
    provider: CompatibleProvider,
    apiKey: string,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    emit: Emit,
  ): Promise<void> {
    const body = buildResponsesRequest(messages, modelId, reasoningEffort, true)
    const endpoint = `${normalizeOpenAiBaseUrl(provider.baseUrl)}/responses`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.headers(apiKey, provider.customHeaders),
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await createProviderError(response)
    await this.readSseStream(response, (line) => this.emitResponsesLine(line, requestId, emit))
  }

  /** Submits an OpenAI-compatible chat request to the durable batch queue. */
  private async streamOpenAiCompatibleBatch(
    provider: CompatibleProvider,
    apiKey: string,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    _emit: Emit,
    batchContext: BatchRequestContext,
  ): Promise<void> {
    const createdAt = new Date().toISOString()
    await this.storage.ensureStreamingBatchMessage(
      batchContext.conversationId,
      batchContext.assistantMessageId,
      createdAt,
      batchContext.messages,
      batchContext.model,
    )
    const { created, customId } = await this.createOpenAiCompatibleBatch(
      provider,
      apiKey,
      modelId,
      messages,
      reasoningEffort,
      signal,
    )
    const batchId = created.id
    if (typeof batchId !== 'string' || !batchId) {
      throw new Error('Batch API returned no batch identifier.')
    }
    const job: PersistedBatchJob = {
      batchId,
      customId,
      requestId,
      conversationId: batchContext.conversationId,
      assistantMessageId: batchContext.assistantMessageId,
      providerId: provider.id,
      modelId,
      batchUrl: provider.batchUrl ?? '',
      createdAt,
      missingPolls: 0,
    }
    await this.storage.saveBatchJob(job)
    await this.waitForQueuedBatch(job, signal)
  }

  /** Runs one internal OpenAI-compatible batch request without adding a visible chat placeholder. */
  private async requestOpenAiCompatibleBatch(
    provider: CompatibleProvider,
    apiKey: string,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const { created, customId } = await this.createOpenAiCompatibleBatch(
      provider,
      apiKey,
      modelId,
      messages,
      reasoningEffort,
      signal,
    )
    return this.pollOpenAiCompatibleBatch(provider, apiKey, created, customId, signal)
  }

  /** Sends a provider batch request and returns the metadata needed to track it. */
  private async createOpenAiCompatibleBatch(
    provider: CompatibleProvider,
    apiKey: string,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
  ): Promise<{ created: Record<string, unknown>; customId: string }> {
    if (!provider.batchUrl) throw new Error('Batch API URL is required for batch models.')
    const resolvedModelId = batchModelId(modelId)
    const reasoningParameters = buildReasoningParameters(resolvedModelId, reasoningEffort, {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
    })
    const completion = {
      messages,
      ...(reasoningParameters ?? {}),
    }
    const customId = randomUUID()
    const response = await fetch(provider.batchUrl, {
      method: 'POST',
      headers: this.headers(apiKey, provider.customHeaders),
      body: JSON.stringify({
        endpoint: '/v1/chat/completions',
        model: resolvedModelId,
        requests: [{ custom_id: customId, body: completion }],
      }),
      signal,
    })
    if (!response.ok) throw await createProviderError(response)
    const created = (await response.json()) as unknown
    if (!isRecord(created)) throw new Error('Batch API returned an invalid creation response.')
    return { created, customId }
  }

  /** Polls a compatible batch endpoint until the request result is ready or terminally fails. */
  private async pollOpenAiCompatibleBatch(
    provider: CompatibleProvider,
    apiKey: string,
    created: Record<string, unknown>,
    customId: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let batch = created
    let missingBatchRetries = 0
    while (true) {
      const result = this.findBatchResult(batch, customId)
      if (result) return result
      const status = typeof batch.status === 'string' ? batch.status.toLowerCase() : ''
      if (['failed', 'cancelled', 'expired'].includes(status)) {
        throw new Error(readBatchError(batch.error))
      }
      if (status === 'completed') throw new Error('Batch API completed without a result.')
      const batchId = batch.id
      if (typeof batchId !== 'string' || !batchId) {
        throw new Error('Batch API returned no batch identifier.')
      }
      await this.waitForDirectBatchPoll(signal)
      const response = await fetch(`${provider.batchUrl}/${encodeURIComponent(batchId)}`, {
        headers: this.headers(apiKey, provider.customHeaders),
        signal,
      })
      if (response.status === 404 && missingBatchRetries < MAX_BATCH_NOT_FOUND_RETRIES) {
        missingBatchRetries += 1
        await response.body?.cancel()
        this.logger.warn(
          'ChatService',
          `Batch ${batchId} is not visible yet; retrying status check ${missingBatchRetries}/${MAX_BATCH_NOT_FOUND_RETRIES}.`,
        )
        continue
      }
      if (!response.ok) throw await createProviderError(response)
      const payload = (await response.json()) as unknown
      if (!isRecord(payload)) throw new Error('Batch API returned an invalid status response.')
      batch = payload
      missingBatchRetries = 0
    }
  }

  /** Finds and validates the completed response body for the submitted batch request. */
  private findBatchResult(
    batch: Record<string, unknown>,
    customId: string,
  ): Record<string, unknown> | null {
    if (!Array.isArray(batch.results)) return null
    const results = batch.results
    if (results.length === 0) return null
    const matched = results.find(
      (item) => isRecord(item) && (item.custom_id === customId || results.length === 1),
    )
    if (!isRecord(matched)) return null
    if (matched.error) throw new Error(readBatchError(matched.error))
    if (!isRecord(matched.response)) throw new Error('Batch API returned an invalid result.')
    const statusCode = matched.response.status_code
    if (typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) {
      throw new Error(readBatchError(matched.response.body))
    }
    if (!isRecord(matched.response.body))
      throw new Error('Batch API returned an invalid response body.')
    return matched.response.body
  }

  /** Runs one status check for every durable batch job not already being checked. */
  private async pollQueuedBatches(): Promise<void> {
    const jobs = await this.storage.listBatchJobs()
    await Promise.allSettled(jobs.map((job) => this.pollQueuedBatch(job)))
  }

  /** Checks one queued batch once and settles its conversation only after a terminal response. */
  private async pollQueuedBatch(job: PersistedBatchJob): Promise<void> {
    if (this.activeBatchPolls.has(job.batchId)) return
    this.activeBatchPolls.add(job.batchId)
    const controller = new AbortController()
    this.batchPollControllers.set(job.batchId, controller)
    try {
      const { provider, apiKey } = this.providers.resolve({
        providerId: job.providerId,
        modelId: job.modelId,
      })
      const response = await fetch(`${job.batchUrl}/${encodeURIComponent(job.batchId)}`, {
        headers: this.headers(apiKey, provider.customHeaders),
        signal: controller.signal,
      })
      if (response.status === 404 && job.missingPolls < MAX_BATCH_NOT_FOUND_RETRIES) {
        const missingPolls = job.missingPolls + 1
        await response.body?.cancel()
        await this.storage.updateBatchJobMissingPolls(job.batchId, missingPolls)
        this.logger.warn(
          'ChatService',
          `Batch ${job.batchId} is not visible yet; retrying status check ${missingPolls}/${MAX_BATCH_NOT_FOUND_RETRIES}.`,
        )
        return
      }
      if (!response.ok) throw await createProviderError(response)
      const batch = (await response.json()) as unknown
      if (!isRecord(batch)) throw new Error('Batch API returned an invalid status response.')
      const result = this.findBatchResult(batch, job.customId)
      if (result) {
        await this.completeQueuedBatch(job, result)
        return
      }
      const status = typeof batch.status === 'string' ? batch.status.toLowerCase() : ''
      if (['failed', 'cancelled', 'expired'].includes(status)) {
        throw new Error(readBatchError(batch.error))
      }
      if (status === 'completed') throw new Error('Batch API completed without a result.')
    } catch (error) {
      if (controller.signal.aborted) return
      await this.failQueuedBatch(
        job,
        error instanceof Error ? error : new Error('The batch request failed.'),
      )
    } finally {
      this.activeBatchPolls.delete(job.batchId)
      this.batchPollControllers.delete(job.batchId)
    }
  }

  /** Persists and broadcasts one completed batch result before releasing its waiting chat request. */
  private async completeQueuedBatch(
    job: PersistedBatchJob,
    result: Record<string, unknown>,
  ): Promise<void> {
    const message = this.readBatchCompletionMessage(result)
    const content = readBatchContent(message.content)
    if (!content) throw new Error('Batch API returned no response text.')
    const reasoning = readReasoningDelta(message)
    const usage = parseTokenUsage(result)
    await this.storage.completeBatchMessage(job, { content, reasoning, usage })
    await this.storage.removeBatchJob(job.batchId)
    if (usage) {
      this.batchEmitter?.({
        requestId: job.requestId,
        type: 'usage',
        usage,
        conversationId: job.conversationId,
        assistantMessageId: job.assistantMessageId,
      })
    }
    if (reasoning) {
      this.batchEmitter?.({
        requestId: job.requestId,
        type: 'reasoning',
        delta: reasoning,
        conversationId: job.conversationId,
        assistantMessageId: job.assistantMessageId,
      })
    }
    this.batchEmitter?.({
      requestId: job.requestId,
      type: 'content',
      delta: content,
      replace: true,
      conversationId: job.conversationId,
      assistantMessageId: job.assistantMessageId,
    })
    this.batchEmitter?.({
      requestId: job.requestId,
      type: 'complete',
      conversationId: job.conversationId,
      assistantMessageId: job.assistantMessageId,
    })
    this.resolveBatchWaiter(job.batchId)
  }

  /** Persists a terminal batch error and rejects its live request when one is still awaiting it. */
  private async failQueuedBatch(job: PersistedBatchJob, error: Error): Promise<void> {
    await this.storage.failBatchMessage(job, error.message)
    await this.storage.removeBatchJob(job.batchId)
    this.batchEmitter?.({
      requestId: job.requestId,
      type: 'error',
      message: error.message,
      conversationId: job.conversationId,
      assistantMessageId: job.assistantMessageId,
    })
    const waiter = this.batchWaiters.get(job.batchId)
    if (!waiter) {
      this.logger.warn(
        'ChatService',
        `Batch ${job.batchId} failed after application restart.`,
        error,
      )
      return
    }
    this.batchWaiters.delete(job.batchId)
    waiter.cleanup()
    waiter.reject(error)
  }

  /** Waits for the durable queue worker to settle one submitted user-visible batch request. */
  private async waitForQueuedBatch(job: PersistedBatchJob, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('The request was stopped.')
    await new Promise<void>((resolve, reject) => {
      /** Removes the abort listener once the batch reaches any local terminal outcome. */
      const cleanup = (): void => signal.removeEventListener('abort', abort)
      /** Rejects the live request while leaving the remote batch intact until explicit stop cleanup runs. */
      const abort = (): void => {
        this.batchWaiters.delete(job.batchId)
        cleanup()
        reject(new Error('The request was stopped.'))
      }
      this.batchWaiters.set(job.batchId, { resolve, reject, cleanup })
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  /** Resolves a live request after its queue worker has durably written the completed response. */
  private resolveBatchWaiter(batchId: string): void {
    const waiter = this.batchWaiters.get(batchId)
    if (!waiter) return
    this.batchWaiters.delete(batchId)
    waiter.cleanup()
    waiter.resolve()
  }

  /** Removes queued batch jobs explicitly stopped by the user without cancelling the remote provider job. */
  private async abandonQueuedBatches(requestId: string): Promise<void> {
    const jobs = (await this.storage.listBatchJobs()).filter((job) => job.requestId === requestId)
    await Promise.all(
      jobs.map(async (job) => {
        this.batchPollControllers.get(job.batchId)?.abort()
        await this.storage.removeBatchJob(job.batchId)
      }),
    )
  }

  /** Waits for the next batch-status check while allowing the user to stop the request. */
  private async waitForDirectBatchPoll(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('The request was stopped.')
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      /** Ends the pending timer promptly when the parent chat request is stopped. */
      const abort = (): void => {
        if (timer) clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        reject(new Error('The request was stopped.'))
      }
      /** Advances the poll loop after the configured status-check interval. */
      const next = (): void => {
        signal.removeEventListener('abort', abort)
        resolve()
      }
      timer = setTimeout(next, this.batchPollIntervalMs)
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  /** Reads the first valid OpenAI-compatible assistant message from a batch result body. */
  private readBatchCompletionMessage(result: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(result.choices) || !isRecord(result.choices[0])) {
      throw new Error('Batch API returned no completion choices.')
    }
    const message = result.choices[0].message
    if (!isRecord(message)) throw new Error('Batch API returned no assistant message.')
    return message
  }

  /** Completes one OpenAI-compatible request, preferring cached endpoint and falling back. */
  private async completeOpenAiCompatibleWithFallback(
    provider: CompatibleProvider,
    modelId: string,
    messages: CompatibleMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    if (provider.batchUrl && this.isBatchModel(provider, modelId)) {
      return this.completeOpenAiCompatibleBatch(
        provider,
        modelId,
        messages,
        UTILITY_REASONING_EFFORT,
        signal,
      )
    }
    if (provider.id === 'opencode') {
      return this.completeOpenAiCompatibleStream(provider, modelId, messages, signal)
    }
    const key = this.compatibleCacheKey(provider.id, modelId)
    const preferred = this.compatibleEndpointCache.get(key)

    /** Tries responses first, then chat on failure. */
    const tryResponsesFirst = async (): Promise<string> => {
      try {
        const content = await this.completeOpenAiCompatibleResponses(
          provider,
          modelId,
          messages,
          signal,
        )
        this.compatibleEndpointCache.set(key, 'responses')
        this.logger.info('ChatService', `Cached responses endpoint for ${provider.id}/${modelId}`)
        return content
      } catch (error) {
        if (signal.aborted) throw error
        this.logger.warn(
          'ChatService',
          `Responses quick call failed for ${provider.id}/${modelId}, trying chat.`,
          error,
        )
        const content = await this.completeOpenAiCompatibleChat(provider, modelId, messages, signal)
        this.compatibleEndpointCache.set(key, 'chat')
        this.logger.info('ChatService', `Cached chat endpoint for ${provider.id}/${modelId}`)
        return content
      }
    }

    /** Tries chat first, then responses on any non-abort failure. */
    const tryChatFirst = async (): Promise<string> => {
      try {
        const content = await this.completeOpenAiCompatibleChat(provider, modelId, messages, signal)
        this.compatibleEndpointCache.set(key, 'chat')
        return content
      } catch (error) {
        if (signal.aborted) throw error
        this.logger.warn(
          'ChatService',
          `Chat quick call failed for ${provider.id}/${modelId}, trying responses.`,
          error,
        )
        const content = await this.completeOpenAiCompatibleResponses(
          provider,
          modelId,
          messages,
          signal,
        )
        this.compatibleEndpointCache.set(key, 'responses')
        this.logger.info('ChatService', `Cached responses endpoint for ${provider.id}/${modelId}`)
        return content
      }
    }

    if (preferred === 'responses') return tryResponsesFirst()
    return tryChatFirst()
  }

  /** Collects OpenCode quick-model output through its supported streaming chat transport. */
  private async completeOpenAiCompatibleStream(
    provider: CompatibleProvider,
    modelId: string,
    messages: CompatibleMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const { apiKey } = this.providers.resolve({ providerId: provider.id, modelId })
    let content = ''
    await this.streamOpenAiCompatibleChat(
      provider,
      apiKey,
      modelId,
      messages,
      UTILITY_REASONING_EFFORT,
      signal,
      'quick-opencode',
      (event) => {
        if (event.type === 'content') content += event.delta
      },
    )
    if (!content) throw new Error('Quick Model returned no text.')
    return content
  }

  /** Completes one internal Quick Model request through its configured batch endpoint. */
  private async completeOpenAiCompatibleBatch(
    provider: CompatibleProvider,
    modelId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
  ): Promise<string> {
    const { apiKey } = this.providers.resolve({ providerId: provider.id, modelId })
    const result = await this.requestOpenAiCompatibleBatch(
      provider,
      apiKey,
      modelId,
      messages,
      reasoningEffort,
      signal,
    )
    const content = readBatchContent(this.readBatchCompletionMessage(result).content)
    if (!content) throw new Error('Batch API returned no response text.')
    return content
  }

  /** Performs one non-streaming chat completions Quick Model call. */
  private async completeOpenAiCompatibleChat(
    provider: CompatibleProvider,
    modelId: string,
    messages: CompatibleMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const { apiKey } = this.providers.resolve({ providerId: provider.id, modelId })
    const reasoningParameters = buildReasoningParameters(modelId, UTILITY_REASONING_EFFORT, {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
    })
    const isKimiModel = isKimi25OrNewerModel({ id: modelId })
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: false,
      ...(isKimiModel ? {} : { temperature: 0.2 }),
      ...(reasoningParameters ?? {}),
    }
    // OpenAI reasoning models (o1/o3/o4-mini/gpt-5 non-chat) require max_completion_tokens instead of max_tokens.
    const isOpenAIReasoningModelId = (id: string): boolean => {
      const lower = id.toLowerCase()
      return (
        lower.startsWith('o1') ||
        lower.startsWith('o3') ||
        lower.startsWith('o4-mini') ||
        (lower.startsWith('gpt-5') && !lower.startsWith('gpt-5-chat'))
      )
    }
    if (isOpenAIReasoningModelId(modelId) && body.max_tokens != null) {
      const { max_tokens, ...rest } = body as Record<string, unknown> & { max_tokens?: unknown }
      if ((body as Record<string, unknown>).max_completion_tokens == null) {
        Object.assign(body, { ...rest, max_completion_tokens: max_tokens })
        delete (body as Record<string, unknown>).max_tokens
      } else {
        Object.assign(body, rest)
        delete (body as Record<string, unknown>).max_tokens
      }
    }
    const endpoint = `${normalizeOpenAiBaseUrl(provider.baseUrl)}/chat/completions`
    /** Sends the current body so a provider rejecting the reasoning keys can be retried. */
    const sendRequest = (): Promise<Response> =>
      fetch(endpoint, {
        method: 'POST',
        headers: this.headers(apiKey, provider.customHeaders),
        body: JSON.stringify(body),
        signal,
      })
    let response = await sendRequest()
    if (
      !response.ok &&
      reasoningParameters &&
      (response.status === 400 || response.status === 422)
    ) {
      await response.body?.cancel()
      stripReasoningParameters(body)
      response = await sendRequest()
    }
    if (!response.ok) throw await createProviderError(response)
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('Quick Model returned no text.')
    return content
  }

  /** Performs one non-streaming responses Quick Model call. */
  private async completeOpenAiCompatibleResponses(
    provider: CompatibleProvider,
    modelId: string,
    messages: CompatibleMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const { apiKey } = this.providers.resolve({ providerId: provider.id, modelId })
    const body = buildResponsesRequest(messages, modelId, UTILITY_REASONING_EFFORT, false)
    const endpoint = `${normalizeOpenAiBaseUrl(provider.baseUrl)}/responses`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.headers(apiKey, provider.customHeaders),
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await createProviderError(response)
    const json = (await response.json()) as Record<string, unknown>
    const text = extractResponsesText(json)
    if (!text) throw new Error('Quick Model returned no text.')
    return text
  }

  /** Streams one ChatGPT Responses API completion through live account credentials. */
  private async streamChatGptResponses(
    modelId: string,
    providerId: string,
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    emit: Emit,
  ): Promise<void> {
    const body = buildResponsesRequest(messages, modelId, reasoningEffort, true)
    const response = await this.chatgpt.fetchWithCredentials(providerId, (credentials) =>
      fetch(CHATGPT_RESPONSES_URL, {
        method: 'POST',
        headers: this.chatGptHeaders(credentials.accessToken, credentials.accountId),
        body: JSON.stringify(body),
        signal,
      }),
    )
    if (!response.ok) throw await createProviderError(response)
    await this.readSseStream(response, (line) => this.emitResponsesLine(line, requestId, emit))
  }

  /** Streams one Claude Web completion through an ephemeral account conversation. */
  private async streamClaudeWeb(
    modelId: string,
    providerId: string,
    modelDefinition: { capabilities: { reasoning: boolean }; reasoningEfforts?: unknown },
    messages: CompatibleMessage[],
    reasoningEffort: ChatRequest['reasoningEffort'],
    signal: AbortSignal,
    requestId: string,
    emit: Emit,
  ): Promise<void> {
    const organizationId = await this.claude.organizationId(providerId)
    const conversationId = randomUUID()
    const { prompt, images } = buildClaudePrompt(messages)
    const thinking = resolveClaudeThinking(
      modelDefinition.capabilities.reasoning,
      modelDefinition.reasoningEfforts as Parameters<typeof resolveClaudeThinking>[1],
      reasoningEffort,
    )
    await this.claude.createConversation(
      providerId,
      organizationId,
      conversationId,
      modelId,
      signal,
    )
    try {
      const files = await this.claude.uploadImages(
        providerId,
        organizationId,
        conversationId,
        images,
        signal,
      )
      const payload: Record<string, unknown> = {
        prompt,
        model: modelId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
        locale: 'en-US',
        rendering_mode: 'messages',
        turn_message_uuids: {
          human_message_uuid: randomUUID(),
          assistant_message_uuid: randomUUID(),
        },
        attachments: [],
        files,
        sync_sources: [],
        thinking_mode: thinking.thinkingMode,
        ...(thinking.effort ? { effort: thinking.effort } : {}),
      }
      const response = await this.claude.streamCompletion(
        providerId,
        organizationId,
        conversationId,
        payload,
        signal,
      )
      if (!response.ok) throw await createProviderError(response)
      const emitLine = this.createClaudeLineEmitter(requestId, emit)
      await this.readSseStream(response, emitLine)
    } finally {
      void this.claude.deleteConversation(providerId, organizationId, conversationId)
    }
  }

  /** Reads one SSE body and forwards every complete line to the handler. */
  private async readSseStream(response: Response, onLine: (line: string) => void): Promise<void> {
    if (!response.body) throw new Error('Provider returned an empty stream.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      pending += decoder.decode(chunk.value, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    }
    if (pending) onLine(pending)
  }

  /** Converts one Responses API SSE line into reasoning, content, and usage events. */
  private emitResponsesLine(line: string, requestId: string, emit: Emit): void {
    const delta = parseResponsesSseLine(line)
    if (!delta) return
    if (delta.error) throw new Error(delta.error)
    if (delta.usage) emit({ requestId, type: 'usage', usage: delta.usage })
    if (delta.reasoning) emit({ requestId, type: 'reasoning', delta: delta.reasoning })
    if (delta.content) emit({ requestId, type: 'content', delta: delta.content })
  }

  /** Converts one Claude Web SSE line into reasoning and content events with tool tracking. */
  private createClaudeLineEmitter(requestId: string, emit: Emit): (line: string) => void {
    const accumulator = new ClaudeStreamAccumulator()
    return (line) => {
      for (const output of accumulator.push(line)) {
        emit({ requestId, type: output.type, delta: output.delta })
      }
    }
  }

  /** Converts one SSE data line into reasoning, content, and token-usage events. */
  private emitSseLine(line: string, requestId: string, emit: Emit): void {
    const value = line.trim()
    if (!value.startsWith('data:')) return
    const data = value.slice(5).trim()
    if (!data || data === '[DONE]') return
    let parsed: unknown
    try {
      parsed = JSON.parse(data) as unknown
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const payload = parsed as Record<string, unknown>
    const usage = parseTokenUsage(payload)
    if (usage) emit({ requestId, type: 'usage', usage })
    const choices = payload.choices
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return
    const delta = (choices[0] as { delta?: unknown }).delta
    if (!delta || typeof delta !== 'object') return
    const record = delta as Record<string, unknown>
    const reasoning = readReasoningDelta(record)
    if (reasoning) emit({ requestId, type: 'reasoning', delta: reasoning })
    if (typeof record.content === 'string' && record.content) {
      emit({ requestId, type: 'content', delta: record.content })
    }
  }

  /** Builds title-search queries with the Quick Model and falls back to the user prompt. */
  private async generateSearchQueries(prompt: string, signal: AbortSignal): Promise<string[]> {
    const quick = this.providers.snapshot().quickModel
    if (!quick || !prompt.trim()) return [prompt.trim()].filter(Boolean)
    try {
      const content = await this.completeOnce(
        quick,
        [
          {
            role: 'system',
            content:
              'Return only a JSON array containing 1 to 3 concise web search queries for the user request.',
          },
          { role: 'user', content: prompt },
        ],
        signal,
      )
      const match = content.match(/\[[\s\S]*\]/)
      const parsed: unknown = match ? JSON.parse(match[0]) : null
      if (Array.isArray(parsed)) {
        const queries = parsed.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        )
        if (queries.length > 0) return queries.slice(0, 3)
      }
    } catch {
      // A search remains useful with the original prompt when query planning fails.
    }
    return [prompt.trim()].filter(Boolean)
  }

  /** Performs a non-streaming completion for internal Quick Model tasks. */
  private async completeOnce(
    model: ModelReference,
    messages: CompatibleMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const { provider } = this.providers.resolve(model)
    if (provider.type === 'chatgpt') {
      const body = buildResponsesRequest(messages, model.modelId, UTILITY_REASONING_EFFORT, false)
      const response = await this.chatgpt.fetchWithCredentials(provider.id, (credentials) =>
        fetch(CHATGPT_RESPONSES_URL, {
          method: 'POST',
          headers: this.chatGptHeaders(credentials.accessToken, credentials.accountId),
          body: JSON.stringify(body),
          signal,
        }),
      )
      if (!response.ok) throw await createProviderError(response)
      return extractResponsesText((await response.json()) as Record<string, unknown>)
    }
    if (provider.type === 'claude-web') {
      const organizationId = await this.claude.organizationId(provider.id)
      const conversationId = randomUUID()
      const { prompt } = buildClaudePrompt(messages)
      await this.claude.createConversation(
        provider.id,
        organizationId,
        conversationId,
        model.modelId,
        signal,
      )
      try {
        const response = await this.claude.streamCompletion(
          provider.id,
          organizationId,
          conversationId,
          { prompt, model: model.modelId, rendering_mode: 'messages', files: [] },
          signal,
        )
        if (!response.ok) throw await createProviderError(response)
        let content = ''
        await this.readSseStream(
          response,
          this.createClaudeLineEmitter('complete-once', (event) => {
            if (event.type === 'content') content += event.delta
          }),
        )
        if (!content) throw new Error('Quick Model returned no text.')
        return content
      } finally {
        void this.claude.deleteConversation(provider.id, organizationId, conversationId)
      }
    }
    return this.completeOpenAiCompatibleWithFallback(provider, model.modelId, messages, signal)
  }

  /** Converts durable messages, attachments, and context boundaries into provider messages. */
  private toCompatibleMessages(messages: ChatMessage[]): CompatibleMessage[] {
    const lastBoundary = messages.map((message) => message.role).lastIndexOf('boundary')
    return messages.slice(lastBoundary + 1).flatMap((message): CompatibleMessage[] => {
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system')
        return []
      if (message.role === 'assistant') {
        return [
          {
            role: 'assistant',
            content: message.content,
            ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
          },
        ]
      }
      if (message.role === 'system' || !message.attachments?.length) {
        return [{ role: message.role, content: message.content }]
      }
      const parts: Array<Record<string, unknown>> = [{ type: 'text', text: message.content }]
      for (const attachment of message.attachments) {
        if (attachment.kind === 'image' && attachment.dataUrl) {
          parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } })
        } else {
          parts.push({
            type: 'text',
            text: `Attachment: ${attachment.name}\n${attachment.extractedText || '(No extractable text)'}`,
          })
        }
      }
      return [{ role: 'user', content: parts }]
    })
  }

  /** Creates JSON request headers with optional dual-compatible authentication and custom headers. */
  private headers(
    apiKey: string,
    customHeaders?: Record<string, string> | undefined | undefined,
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(customHeaders ?? {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey } : {}),
    }
  }

  /** Creates the ChatGPT backend headers used by Responses API and upload requests. */
  private chatGptHeaders(accessToken: string, accountId: string): Record<string, string> {
    return {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'oai-device-id': 'aichat-desktop',
      'oai-language': 'en-US',
      'openai-sentinel-chatgpt-token': accessToken,
      'openai-sentinel-proof-token': '',
      'openai-sentinel-account-id': accountId,
      origin: 'https://chatgpt.com',
      referer: 'https://chatgpt.com/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'x-openai-device-id': 'aichat-desktop',
      'x-organization-id': accountId,
    }
  }
}
