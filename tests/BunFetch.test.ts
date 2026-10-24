/** Verifies Bun-compatible TLS ciphers, header casing, decompression, and fetch behavior. */

import http from 'node:http'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUN_CIPHERS,
  BUN_ECDH_CURVES,
  bunFetch,
  executeBunFetch,
  normalizeBunHeaders,
  setBunFetchOverride,
} from '@main/http/bun.fetch'
import {
  buildOpencodeHeaders,
  createOpencodeTraceHeaders,
  opencodeProjectId,
  resetOpencodeClientVersionCache,
} from '@main/providers/opencode/opencode.protocol'

describe('BunFetch TLS and Header Protocol', () => {
  afterEach(() => {
    setBunFetchOverride(null)
    vi.unstubAllGlobals()
    delete process.env.OPENCODE_PROJECT
    resetOpencodeClientVersionCache()
  })

  it('defines the 17 BoringSSL ciphers and curve list configured in Bun', () => {
    const ciphers = BUN_CIPHERS.split(':')
    expect(ciphers).toHaveLength(17)
    expect(ciphers).toContain('TLS_AES_128_GCM_SHA256')
    expect(ciphers).toContain('TLS_AES_256_GCM_SHA384')
    expect(ciphers).toContain('TLS_CHACHA20_POLY1305_SHA256')
    expect(BUN_ECDH_CURVES).toBe('X25519MLKEM768:X25519:P-256:P-384')
  })

  it('normalizes headers to Title-Case and strips browser sec-fetch tokens', () => {
    const raw = {
      'content-type': 'application/json',
      'user-agent': 'opencode/test',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'sec-ch-ua': '"Chromium";v="125"',
      'accept-language': 'en-US,en;q=0.9',
      'x-opencode-client': 'cli',
    }
    const headers = normalizeBunHeaders(raw, new URL('https://opencode.ai/test'), 42)

    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['User-Agent']).toBe('opencode/test')
    expect(headers.Host).toBe('opencode.ai')
    expect(headers['Content-Length']).toBe('42')
    expect(headers['x-opencode-client']).toBe('cli')

    // Browser headers that trigger WAF bot detection must be completely absent
    expect(headers).not.toHaveProperty('sec-fetch-mode')
    expect(headers).not.toHaveProperty('sec-fetch-dest')
    expect(headers).not.toHaveProperty('sec-ch-ua')
    expect(headers).not.toHaveProperty('accept-language')
  })

  it('generates a 40-character hex project identifier and caches it across requests', () => {
    const first = opencodeProjectId()
    expect(first).toMatch(/^[0-9a-f]{40}$/)
    const second = opencodeProjectId()
    expect(first).toBe(second)

    process.env.OPENCODE_PROJECT = 'custom-project-id'
    expect(opencodeProjectId()).toBe('custom-project-id')
  })

  it('generates compliant W3C and B3 distributed trace headers', () => {
    const traces = createOpencodeTraceHeaders()
    expect(traces.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(traces.b3).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-1-[0-9a-f]{16}$/)
  })

  it('builds canonical OpenCode request headers with Bun wire casing', () => {
    const headers = buildOpencodeHeaders({
      version: '2.1.4',
      apiKey: '',
      conversationId: 'test-conversation-123',
      customHeaders: { 'x-custom': 'val', 'User-Agent': 'ignored', 'x-api-key': 'ignored' },
    })

    expect(headers['User-Agent']).toBe('opencode/latest/2.1.4/cli')
    expect(headers.Authorization).toBe('Bearer public')
    expect(headers['x-opencode-client']).toBe('cli')
    expect(headers['x-opencode-project']).toMatch(/^[0-9a-f]{40}$/)
    expect(headers['x-opencode-session']).toMatch(/^ses_[0-9a-f]{12}[A-Za-z0-9]{14}$/)
    expect(headers['x-opencode-session-id']).toBe(headers['x-opencode-session'])
    expect(headers['x-session-affinity']).toBe(headers['x-opencode-session'])
    expect(headers['x-session-id']).toBe(headers['x-opencode-session'])
    expect(headers['X-Session-Id']).toBe(headers['x-opencode-session'])
    expect(headers.Accept).toBe('*/*')
    expect(headers['Accept-Encoding']).toBe('gzip, deflate, br, zstd')
    expect(headers.Connection).toBe('keep-alive')
    expect(headers['x-custom']).toBe('val')
    expect(headers).not.toHaveProperty('x-api-key')
  })

  it('executes real HTTP requests, streaming response body and decompressing gzip', async () => {
    let capturedHeaders: http.IncomingHttpHeaders | null = null

    const server = http.createServer((req, res) => {
      capturedHeaders = req.headers
      if (req.url === '/gzip') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        })
        const payload = Buffer.from(JSON.stringify({ compressed: true }))
        res.end(zlib.gzipSync(payload))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port

    try {
      const response = await executeBunFetch(`http://127.0.0.1:${port}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'opencode/latest/2.1.4/cli',
          'x-opencode-client': 'cli',
        },
        body: JSON.stringify({ ping: 'pong' }),
      })

      expect(response.status).toBe(200)
      expect(response.ok).toBe(true)
      const data = (await response.json()) as { ok: boolean }
      expect(data.ok).toBe(true)
      expect(capturedHeaders?.['x-opencode-client']).toBe('cli')
      expect(capturedHeaders?.['content-type']).toBe('application/json')
      expect(capturedHeaders?.['content-length']).toBe(
        String(Buffer.byteLength(JSON.stringify({ ping: 'pong' }))),
      )

      // Test automatic gzip decompression
      const gzipResponse = await executeBunFetch(`http://127.0.0.1:${port}/gzip`)
      expect(gzipResponse.status).toBe(200)
      const gzipData = (await gzipResponse.json()) as { compressed: boolean }
      expect(gzipData.compressed).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('rejects when AbortSignal is cancelled', async () => {
    const ac = new AbortController()
    ac.abort()

    await expect(
      executeBunFetch('http://127.0.0.1:65534/never', {
        signal: ac.signal,
      }),
    ).rejects.toThrow()
  })

  it('delegates to test mocks when global fetch is stubbed', async () => {
    const mock = vi.fn(async () => new Response('{"mocked":true}', { status: 200 }))
    vi.stubGlobal('fetch', mock)

    const response = await bunFetch('https://opencode.ai/test')
    expect(response.status).toBe(200)
    expect(mock).toHaveBeenCalledOnce()
    const json = (await response.json()) as { mocked: boolean }
    expect(json.mocked).toBe(true)
  })
})
