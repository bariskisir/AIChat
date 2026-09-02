/** Verifies durable batch-model routing for OpenAI-compatible chat providers. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, ChatStreamEvent, ProviderSummary } from '@shared/index'
import type { PersistedBatchJob } from '@main/persistence/storage.service'
import ChatService from '@main/chat/chat.service'

/** Returns a minimal request with one user message for compatible-provider tests. */
const createRequest = (modelId: string): ChatRequest => ({
  requestId: 'f3cdb6ac-8eaa-479e-9a67-37e5af58c100',
  conversationId: '5da0c64d-a2f4-4ab9-9a00-eef49ebba100',
  assistantMessageId: '38f298d4-bd3f-4b82-a230-7e35ca03f100',
  model: { providerId: 'provider', modelId },
  messages: [
    {
      id: '082a0275-a382-4e41-849a-539f3927d100',
      role: 'user',
      content: '2 + 2',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'complete',
    },
  ],
  searchMode: 'off',
  useWebSearchFallback: true,
  reasoningEffort: 'default',
  imageGeneration: false,
})

/** Creates the minimum provider metadata required by the chat service. */
const createProvider = (batchUrl?: string, id = 'openrouter'): ProviderSummary => ({
  id,
  name: id === 'openrouter' ? 'OpenRouter' : 'Provider',
  type: 'openai-compatible',
  baseUrl: 'https://provider.example/v1',
  ...(batchUrl ? { batchUrl } : {}),
  batchPollIntervalSeconds: 30,
  batchModelRegex: 'batch',
  builtin: false,
  enabled: true,
  hasApiKey: true,
  modelCount: 1,
})

/** Implements the local batch queue surface used by the chat service in isolation. */
const createStorage = () => {
  const jobs: PersistedBatchJob[] = []
  return {
    jobs,
    getConversation: vi.fn(async () => ({ isDefaultTitle: false })),
    ensureStreamingBatchMessage: vi.fn(async () => null),
    listBatchJobs: vi.fn(async () => [...jobs]),
    saveBatchJob: vi.fn(async (job: PersistedBatchJob) => {
      jobs.push(job)
    }),
    updateBatchJobMissingPolls: vi.fn(async (batchId: string, missingPolls: number) => {
      const job = jobs.find((item) => item.batchId === batchId)
      if (job) job.missingPolls = missingPolls
    }),
    removeBatchJob: vi.fn(async (batchId: string) => {
      const index = jobs.findIndex((item) => item.batchId === batchId)
      if (index >= 0) jobs.splice(index, 1)
    }),
    completeBatchMessage: vi.fn(async () => null),
    failBatchMessage: vi.fn(async () => null),
  }
}

/** Creates a chat service with deterministic provider and queue dependencies. */
const createService = (provider: ProviderSummary, storage = createStorage()) => {
  const providers = {
    snapshot: vi.fn(() => ({ providers: [provider] })),
    resolve: vi.fn(() => ({
      provider,
      apiKey: 'test-key',
      modelDefinition: {
        modelId: 'anthropic/claude-fable-5.1:batch',
        name: 'Claude Fable',
        group: 'Anthropic',
        capabilities: { chat: true, vision: false, imageGeneration: false, reasoning: false },
      },
    })),
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    service: new ChatService(
      providers as never,
      {} as never,
      {} as never,
      storage as never,
      logger as never,
    ),
    storage,
  }
}

/** Lets promise continuations enqueue their durable batch job before time advances. */
const flushPromises = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ChatService batch routing', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('persists case-insensitive batch-matching chats and checks their result every 30 seconds', async () => {
    const fetchMock = vi
      .fn<(_input: string | URL | Request, _init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'batch-1', status: 'validating' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'completed',
            results: [
              {
                custom_id: 'request-1',
                response: {
                  status_code: 200,
                  body: {
                    choices: [{ message: { content: '4' } }],
                    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    const events: ChatStreamEvent[] = []
    const { service, storage } = createService(
      createProvider('https://provider.example/api/batches'),
    )
    await service.startBatchQueue((event) => events.push(event))

    const request = createRequest('anthropic/claude-fable-5.1:BATCH')
    const pending = service.start(request, (event) => events.push(event))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1)

    expect(storage.saveBatchJob).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-1', requestId: request.requestId }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/api/batches',
      expect.objectContaining({ method: 'POST' }),
    )
    const firstCall = fetchMock.mock.calls[0]
    if (!firstCall) throw new Error('Batch endpoint was not called.')
    const requestBody = JSON.parse((firstCall[1] as RequestInit).body as string)
    expect(requestBody).toMatchObject({
      endpoint: '/v1/chat/completions',
      model: 'anthropic/claude-fable-5.1',
      requests: [{ body: { messages: [{ role: 'user', content: '2 + 2' }] } }],
    })

    await vi.advanceTimersByTimeAsync(29_999)
    await pending

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/api/batches/batch-1',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
    expect(storage.completeBatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-1' }),
      expect.objectContaining({ content: '4' }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        requestId: request.requestId,
        type: 'content',
        delta: '4',
        replace: true,
      }),
    )
  })

  it('uses the normal completion endpoint when no batch URL is configured', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('data: {"choices":[{"delta":{"content":"4"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: ChatStreamEvent[] = []

    const request = createRequest('anthropic/claude-fable-5.1:batch')
    await createService(createProvider()).service.start(request, (event) => events.push(event))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toContainEqual({ requestId: request.requestId, type: 'content', delta: '4' })
  })

  it('keeps batch-looking models on normal endpoints for non-OpenRouter providers', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('data: {"choices":[{"delta":{"content":"4"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createService(
      createProvider('https://provider.example/api/batches', 'other-provider'),
    ).service.start(createRequest('vendor/model:BATCH'), vi.fn())

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the streaming chat endpoint for OpenCode quick-model tasks', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('data: {"choices":[{"delta":{"content":"Title"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProvider(undefined, 'opencode')
    const { service } = createService(provider)
    const completeQuick = service as unknown as {
      completeOpenAiCompatibleWithFallback: (
        inputProvider: ProviderSummary,
        modelId: string,
        messages: Array<{ role: 'user'; content: string }>,
        signal: AbortSignal,
      ) => Promise<string>
    }

    await expect(
      completeQuick.completeOpenAiCompatibleWithFallback(
        provider,
        'muse-spark-1.2-contributor-free',
        [{ role: 'user', content: 'Name this conversation.' }],
        AbortSignal.timeout(1_000),
      ),
    ).resolves.toBe('Title')

    const request = fetchMock.mock.calls[0]
    if (!request) throw new Error('OpenCode chat endpoint was not called.')
    expect(JSON.parse((request[1] as RequestInit).body as string)).toMatchObject({ stream: true })
  })

  it('continues a saved batch after application restart and writes its result to storage', async () => {
    const storage = createStorage()
    storage.jobs.push({
      batchId: 'batch-recovered',
      customId: 'request-1',
      requestId: 'f3cdb6ac-8eaa-479e-9a67-37e5af58c100',
      conversationId: '5da0c64d-a2f4-4ab9-9a00-eef49ebba100',
      assistantMessageId: '38f298d4-bd3f-4b82-a230-7e35ca03f100',
      providerId: 'provider',
      modelId: 'deepseek/deepseek-v4-flash-0731:batch',
      batchUrl: 'https://provider.example/api/batches',
      createdAt: '2026-01-01T00:00:00.000Z',
      missingPolls: 0,
    })
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            status: 'completed',
            results: [
              {
                custom_id: 'request-1',
                response: { status_code: 200, body: { choices: [{ message: { content: '4' } }] } },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { service } = createService(
      createProvider('https://provider.example/api/batches'),
      storage,
    )

    await service.startBatchQueue(vi.fn())

    expect(storage.completeBatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-recovered' }),
      expect.objectContaining({ content: '4' }),
    )
    await expect(service.getQueuedBatchConversationIds()).resolves.toEqual([])
  })
})
