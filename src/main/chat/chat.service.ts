/** Orchestrates multi-type chat streaming: OpenAI-compatible, ChatGPT, and Claude Web. */

import { randomUUID } from 'node:crypto'
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ModelReference,
  WebSearchMode,
} from '@shared/index'
import { clampSurrogateBoundary } from '@shared/index'
import { buildReasoningParameters } from '../reasoning/index'
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
import type { WebSearchResult } from '../search/web.search.service'
import WebSearchService from '../search/web.search.service'
import { createProviderError, parseTokenUsage, readReasoningDelta } from './chat.errors'
import { fallbackTitle, sanitizeTitle, TITLE_SYSTEM_PROMPT } from './title.generator'

type Emit = (event: ChatStreamEvent) => void

interface CompatibleMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
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

  /** Creates a chat orchestrator from provider, auth, storage, logging, and web-search services. */
  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly chatgpt: ChatGptAuth,
    private readonly claude: ClaudeWebAuth,
    private readonly storage: StorageService,
    logger: LoggerService,
  ) {
    this.webSearch = new WebSearchService(logger)
  }

  /** Runs one request and emits isolated incremental events until completion or failure. */
  public async start(request: ChatRequest, emit: Emit): Promise<void> {
    if (this.active.has(request.requestId)) throw new Error('This request is already active.')
    const controller = new AbortController()
    this.active.set(request.requestId, controller)
    try {
      const titleWasDefault = await this.assignTitleFromFirstMessage(request, emit)
      if (request.imageGeneration) {
        emit({ requestId: request.requestId, type: 'status', status: 'generating' })
        await this.generateImage(request, controller.signal, emit)
      } else {
        await this.generateChat(request, controller.signal, emit)
      }
      if (!controller.signal.aborted) {
        emit({ requestId: request.requestId, type: 'complete' })
        if (titleWasDefault) void this.generateTitle(request, emit)
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

  /** Refines the fallback title with the Quick Model after the first answer completes. */
  private async generateTitle(request: ChatRequest, emit: Emit): Promise<void> {
    const { quickModel, titleGenerationEnabled } = this.providers.snapshot()
    if (!titleGenerationEnabled || !quickModel) return
    const userText = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join(' ')
      .trim()
    if (!userText) return
    emit({
      requestId: request.requestId,
      type: 'status',
      status: 'generating-title',
      conversationId: request.conversationId,
    })
    try {
      const content = await this.completeOnce(
        quickModel,
        [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: userText.slice(0, clampSurrogateBoundary(userText, 2_000)) },
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
        signal,
        (query, count, done) => {
          emit({
            requestId: request.requestId,
            type: 'searchProgress',
            query,
            engine: request.searchMode as Exclude<WebSearchMode, 'off'>,
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
    const response = await fetch(`${normalizeOpenAiBaseUrl(provider.baseUrl)}/images/generations`, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify({ model: request.model.modelId, prompt, response_format: 'b64_json' }),
      signal,
    })
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
    const reasoningParameters = buildReasoningParameters(model.modelId, reasoningEffort, {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
    })
    const body: Record<string, unknown> = {
      model: model.modelId,
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
        headers: this.headers(apiKey),
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
      delete body.thinking
      delete body.enable_thinking
      delete body.reasoning_effort
      delete body.reasoning
      delete body.disable_reasoning
      delete body.chat_template_kwargs
      delete body.thinking_budget
      delete body.extra_body
      delete body.incremental_output
      response = await sendRequest()
    }
    if (!response.ok) throw await createProviderError(response)
    await this.readSseStream(response, (line) => this.emitSseLine(line, requestId, emit))
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
      const body = buildResponsesRequest(messages, model.modelId, 'medium', false)
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
    const { apiKey } = this.providers.resolve(model)
    const response = await fetch(`${normalizeOpenAiBaseUrl(provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify({ model: model.modelId, messages, stream: false, temperature: 0.2 }),
      signal,
    })
    if (!response.ok) throw await createProviderError(response)
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('Quick Model returned no text.')
    return content
  }

  /** Converts durable messages, attachments, and context boundaries into provider messages. */
  private toCompatibleMessages(messages: ChatMessage[]): CompatibleMessage[] {
    const lastBoundary = messages.map((message) => message.role).lastIndexOf('boundary')
    return messages.slice(lastBoundary + 1).flatMap((message): CompatibleMessage[] => {
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system')
        return []
      if (message.role !== 'user' || !message.attachments?.length) {
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

  /** Creates JSON request headers with optional dual-compatible authentication. */
  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
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
