/** Verifies per-conversation OpenCode session identifiers sent with compatible chat requests. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, ChatStreamEvent, ProviderSummary } from '@shared/index'
import ChatService, { opencodeSessionId } from '@main/chat/chat.service'

/** Returns a minimal request with one user message for the given conversation. */
const createRequest = (conversationId: string, requestId: string): ChatRequest => ({
  requestId,
  conversationId,
  assistantMessageId: '38f298d4-bd3f-4b82-a230-7e35ca03f100',
  model: { providerId: 'opencode', modelId: 'muse-spark-1.2-contributor-free' },
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
const createProvider = (id = 'opencode'): ProviderSummary => ({
  id,
  name: id === 'opencode' ? 'OpenCode' : 'Provider',
  type: 'openai-compatible',
  baseUrl: id === 'opencode' ? 'https://opencode.ai/zen/v1' : 'https://provider.example/v1',
  builtin: false,
  enabled: true,
  hasApiKey: true,
  modelCount: 1,
})

/** Implements the minimal storage surface used by the chat service in isolation. */
const createStorage = () => ({
  getConversation: vi.fn(async () => ({ isDefaultTitle: false })),
  loadSettings: vi.fn(async () => ({ language: 'en' })),
})

/** Creates a chat service with deterministic provider and storage dependencies. */
const createService = (provider: ProviderSummary) => {
  const providers = {
    snapshot: vi.fn(() => ({ providers: [provider], quickModel: null })),
    resolve: vi.fn(() => ({
      provider,
      apiKey: 'test-key',
      modelDefinition: {
        modelId: 'muse-spark-1.2-contributor-free',
        name: 'Muse Spark',
        group: 'OpenCode',
        capabilities: { chat: true, vision: false, imageGeneration: false, reasoning: false },
      },
    })),
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return new ChatService(
    providers as never,
    {} as never,
    {} as never,
    createStorage() as never,
    logger as never,
  )
}

/** Returns one OpenAI-compatible streaming chat response for the fetch stub. */
const streamedResponse = (): Response =>
  new Response('data: {"choices":[{"delta":{"content":"4"}}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })

/** Reads the request headers recorded for one fetch mock call. */
const requestHeaders = (init: RequestInit | undefined): Record<string, string> =>
  (init as RequestInit).headers as Record<string, string>

describe('ChatService OpenCode session headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives a stable, prefixed session identifier from a conversation', () => {
    const first = '5da0c64d-a2f4-4ab9-9a00-eef49ebba100'
    const second = 'f3cdb6ac-8eaa-479e-9a67-37e5af58c100'
    expect(opencodeSessionId(first)).toMatch(/^ses_[a-z0-9]+$/)
    expect(opencodeSessionId(first)).toBe(opencodeSessionId(first))
    expect(opencodeSessionId(first)).not.toBe(opencodeSessionId(second))
  })

  it('sends the same session header for every OpenCode request in one conversation', async () => {
    const fetchMock = vi.fn<
      (_input: string | URL | Request, _init?: RequestInit) => Promise<Response>
    >(async () => streamedResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = createService(createProvider())
    const events: ChatStreamEvent[] = []

    await service.start(
      createRequest('5da0c64d-a2f4-4ab9-9a00-eef49ebba100', 'request-1'),
      (event) => events.push(event),
    )
    await service.start(
      createRequest('5da0c64d-a2f4-4ab9-9a00-eef49ebba100', 'request-2'),
      (event) => events.push(event),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const expected = opencodeSessionId('5da0c64d-a2f4-4ab9-9a00-eef49ebba100')
    const firstCall = fetchMock.mock.calls[0]
    const secondCall = fetchMock.mock.calls[1]
    if (!firstCall || !secondCall) throw new Error('OpenCode endpoint was not called.')
    expect(requestHeaders(firstCall[1])['x-opencode-session']).toBe(expected)
    expect(requestHeaders(secondCall[1])['x-opencode-session']).toBe(expected)
    expect(events).toContainEqual({ requestId: 'request-1', type: 'complete' })
  })

  it('sends the conversation session header on OpenCode quick-model calls', async () => {
    const fetchMock = vi.fn<
      (_input: string | URL | Request, _init?: RequestInit) => Promise<Response>
    >(async () => streamedResponse())
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProvider()
    const service = createService(provider) as unknown as {
      completeOpenAiCompatibleWithFallback: (
        inputProvider: ProviderSummary,
        modelId: string,
        messages: Array<{ role: 'user'; content: string }>,
        signal: AbortSignal,
        conversationId?: string | undefined,
      ) => Promise<string>
    }

    await expect(
      service.completeOpenAiCompatibleWithFallback(
        provider,
        'muse-spark-1.2-contributor-free',
        [{ role: 'user', content: 'Name this conversation.' }],
        AbortSignal.timeout(1_000),
        '5da0c64d-a2f4-4ab9-9a00-eef49ebba100',
      ),
    ).resolves.toBe('4')

    const request = fetchMock.mock.calls[0]
    if (!request) throw new Error('OpenCode endpoint was not called.')
    expect(requestHeaders(request[1])['x-opencode-session']).toBe(
      opencodeSessionId('5da0c64d-a2f4-4ab9-9a00-eef49ebba100'),
    )
  })

  it('omits the session header for non-OpenCode providers', async () => {
    const fetchMock = vi.fn<
      (_input: string | URL | Request, _init?: RequestInit) => Promise<Response>
    >(async () => streamedResponse())
    vi.stubGlobal('fetch', fetchMock)
    const service = createService(createProvider('deepseek'))

    await service.start(createRequest('5da0c64d-a2f4-4ab9-9a00-eef49ebba100', 'request-1'), vi.fn())

    const request = fetchMock.mock.calls[0]
    if (!request) throw new Error('Provider endpoint was not called.')
    expect(requestHeaders(request[1])).not.toHaveProperty('x-opencode-session')
  })
})
