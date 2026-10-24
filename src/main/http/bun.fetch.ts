/**
 * Drop-in fetch implementation that replicates Bun's BoringSSL TLS signature,
 * Title-Case header preserving behavior, and HTTP/1.1 wire characteristics.
 *
 * Used exclusively for OpenCode provider calls so Cloudflare WAF accepts requests
 * without classifying Node/Chromium network fingerprints as automated scrapers.
 */

import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'

/** Exact 17 BoringSSL cipher suites used by Bun. */
export const BUN_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES128-SHA',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-ECDSA-AES256-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':')

/** Quantum-resistant and standard elliptic curves configured in Bun BoringSSL. */
export const BUN_ECDH_CURVES = 'X25519MLKEM768:X25519:P-256:P-384'

/** Headers that Undici or Chromium inject that trigger Cloudflare bot detection. */
const FORBIDDEN_HEADERS_REGEX = /^(sec-fetch-|sec-ch-|accept-language$)/i

/** Canonical Title-Case representation for standard HTTP headers preserved by Bun. */
const CANONICAL_TITLE_CASE: Record<string, string> = {
  host: 'Host',
  'user-agent': 'User-Agent',
  connection: 'Connection',
  'content-type': 'Content-Type',
  'content-length': 'Content-Length',
  accept: 'Accept',
  'accept-encoding': 'Accept-Encoding',
  authorization: 'Authorization',
}

/** Options accepted by BunFetch. */
export interface BunFetchInit extends RequestInit {
  bypassMock?: boolean
}

/** Optional test override installed during unit testing. */
let bunFetchOverride: typeof fetch | null = null

/** Configures an explicit fetcher override for tests. */
export const setBunFetchOverride = (fetcher: typeof fetch | null): void => {
  bunFetchOverride = fetcher
}

/** Checks whether global fetch has been stubbed (for example via vi.stubGlobal in Vitest). */
export const isFetchMocked = (): boolean => {
  if (bunFetchOverride) return true
  const globalFetch = globalThis.fetch as { mock?: unknown } | undefined
  return typeof globalFetch?.mock === 'object' && globalFetch.mock !== null
}

/** Formats headers with Bun casing, adding Host/Content-Length and omitting browser tokens. */
export const normalizeBunHeaders = (
  rawHeaders: HeadersInit | undefined,
  url: URL,
  contentLength?: number,
): Record<string, string> => {
  const headers: Record<string, string> = {}

  const addHeader = (name: string, value: string): void => {
    if (FORBIDDEN_HEADERS_REGEX.test(name)) return
    const canonical = CANONICAL_TITLE_CASE[name.toLowerCase()] ?? name
    headers[canonical] = value
  }

  if (rawHeaders) {
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((val, key) => {
        addHeader(key, val)
      })
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, val] of rawHeaders) {
        if (typeof key === 'string' && typeof val === 'string') {
          addHeader(key, val)
        }
      }
    } else {
      for (const [key, val] of Object.entries(rawHeaders)) {
        if (typeof val === 'string') {
          addHeader(key, val)
        }
      }
    }
  }

  const hasHost = Object.keys(headers).some((k) => k.toLowerCase() === 'host')
  if (!hasHost) {
    headers.Host = url.host
  }

  const hasContentLength = Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')
  if (!hasContentLength && typeof contentLength === 'number' && contentLength >= 0) {
    headers['Content-Length'] = String(contentLength)
  }

  return headers
}

/** Converts fetch request body into a Buffer suitable for node:https writing. */
const toBuffer = async (body: BodyInit | null | undefined): Promise<Buffer | null> => {
  if (body === null || body === undefined) return null
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (typeof (body as Blob).arrayBuffer === 'function') {
    const arrayBuffer = await (body as Blob).arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
  if (typeof (body as ReadableStream).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)))
  }
  return Buffer.from(String(body), 'utf8')
}

/** Performs the direct TLS request using Bun's exact ciphers, curves, and headers. */
export const executeBunFetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  if (signal?.aborted) {
    const reason = signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
    return Promise.reject(reason)
  }

  const urlStr =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const url = new URL(urlStr)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const rawBody = init?.body ?? (input instanceof Request ? input.body : undefined)
  const bodyBuffer = await toBuffer(rawBody)

  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http

  const rawHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined)
  const headers = normalizeBunHeaders(rawHeaders, url, bodyBuffer?.length)

  return new Promise<Response>((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: url.pathname + url.search,
      method,
      headers,
      signal,
    }

    if (isHttps) {
      options.ciphers = BUN_CIPHERS
      options.ecdhCurve = BUN_ECDH_CURVES
      options.minVersion = 'TLSv1.2'
      options.maxVersion = 'TLSv1.3'
    }

    const req = transport.request(options, (res) => {
      const encoding = (res.headers['content-encoding'] || '').toLowerCase().trim()
      let stream: NodeJS.ReadableStream = res
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip())
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate())
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress())
      }

      const statusCode = res.statusCode ?? 200
      const isNullBodyStatus = statusCode === 204 || statusCode === 304 || method === 'HEAD'
      const bodyStream = isNullBodyStatus ? null : Readable.toWeb(stream as Readable)

      const response = new Response(bodyStream as BodyInit | null, {
        status: statusCode,
        statusText: res.statusMessage ?? '',
        headers: res.headers as HeadersInit,
      })

      resolve(response)
    })

    req.on('error', (err) => {
      reject(err)
    })

    if (bodyBuffer && bodyBuffer.length > 0) {
      req.write(bodyBuffer)
    }
    req.end()
  })
}

/**
 * Drop-in fetch replacement that replicates Bun's TLS fingerprint and HTTP headers.
 * When running under test environments with mocked global fetch, delegates to the mock
 * unless bypassMock is explicitly set.
 */
export const bunFetch = async (
  input: string | URL | Request,
  init?: BunFetchInit,
): Promise<Response> => {
  if (!init?.bypassMock && isFetchMocked()) {
    const implementation = bunFetchOverride ?? globalThis.fetch
    return implementation(input as never, init)
  }
  return executeBunFetch(input, init)
}
