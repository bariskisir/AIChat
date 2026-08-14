/** Verifies web-search page fetching falls back to hidden-window rendering on failed fetches. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSearchService from '../src/main/search/web.search.service'

vi.mock('electron', () => ({
  BrowserWindow: class {},
}))

interface StubbedService {
  fetchPageWithWindowFallback: ReturnType<typeof vi.fn>
  extractWithReadability: ReturnType<typeof vi.fn>
  fetchPageContent: (url: string, signal: AbortSignal) => Promise<unknown>
}

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as ConstructorParameters<typeof WebSearchService>[0]

const infoMock = vi.mocked(fakeLogger.info)
const warnMock = vi.mocked(fakeLogger.warn)

const article = { title: 'Recovered', url: 'https://example.com', content: '# Recovered' }

const setup = (): StubbedService => {
  const service = new WebSearchService(fakeLogger) as unknown as StubbedService
  service.fetchPageWithWindowFallback = vi.fn(async () => article)
  service.extractWithReadability = vi.fn(async () => article)
  return service
}

describe('WebSearchService fetch fallback', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    infoMock.mockClear()
    warnMock.mockClear()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  it('recovers pages whose HTTP response is rejected', async () => {
    const service = setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response)

    const result = await service.fetchPageContent(
      'https://example.com',
      new AbortController().signal,
    )

    expect(result).toEqual(article)
    expect(service.fetchPageWithWindowFallback).toHaveBeenCalledWith(
      'https://example.com',
      expect.any(AbortSignal),
    )
  })

  it('recovers pages whose body cannot be read', async () => {
    const service = setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, body: null } as Response)

    const result = await service.fetchPageContent(
      'https://example.com',
      new AbortController().signal,
    )

    expect(result).toEqual(article)
    expect(service.fetchPageWithWindowFallback).toHaveBeenCalledTimes(1)
  })

  it('recovers pages whose network request throws', async () => {
    const service = setup()
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await service.fetchPageContent(
      'https://example.com',
      new AbortController().signal,
    )

    expect(result).toEqual(article)
    expect(service.fetchPageWithWindowFallback).toHaveBeenCalledTimes(1)
  })

  it('does not fall back when the primary fetch and extraction succeed', async () => {
    const service = setup()
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('<html><body><article>Hello</article></body></html>')]
    const response = {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            chunks.length > 0
              ? { done: false, value: chunks.shift() as Uint8Array }
              : { done: true, value: undefined },
        }),
      },
    } as unknown as Response
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(response)

    const result = await service.fetchPageContent(
      'https://example.com',
      new AbortController().signal,
    )

    expect(result).toEqual(article)
    expect(service.fetchPageWithWindowFallback).not.toHaveBeenCalled()
  })

  it('rethrows when the caller aborts, without touching the fallback', async () => {
    const service = setup()
    const controller = new AbortController()
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
    controller.abort()

    await expect(
      service.fetchPageContent('https://example.com', controller.signal),
    ).rejects.toThrow()
    expect(service.fetchPageWithWindowFallback).not.toHaveBeenCalled()
  })

  it('returns null when the fallback cannot recover the page', async () => {
    const service = setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    service.fetchPageWithWindowFallback = vi.fn(async () => null)

    const result = await service.fetchPageContent(
      'https://example.com',
      new AbortController().signal,
    )

    expect(result).toBeNull()
  })

  it('returns empty results immediately when queries are empty or whitespace', async () => {
    const service = new WebSearchService(fakeLogger)
    const result = await service.search(
      'duckduckgo',
      ['', '   '],
      'en',
      true,
      new AbortController().signal,
    )
    expect(result).toEqual({ citations: [], context: '' })
  })
})
