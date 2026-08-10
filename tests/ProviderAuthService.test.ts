/**
 * Verifies per-provider ChatGPT OAuth browser and callback ordering, proactive token
 * refresh, the one-time retry after a 401 response, and credential isolation between
 * multiple ChatGPT provider instances.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type LoggerService from '@main/logging/logger.service'
import { ChatGptAuth } from '@main/providers/chatgpt/chatgpt.auth'
import type { ChatGptCredentials } from '@main/providers/chatgpt/chatgpt.types'

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  shell: { openExternal: electronMocks.openExternal },
}))

let rootPath = ''

/** Creates the logger surface needed by the authentication service. */
const createLogger = (): LoggerService =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as LoggerService

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'ai-chat-auth-test-'))
  electronMocks.openExternal.mockClear()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(rootPath, { recursive: true, force: true })
})

/** Creates a structurally valid JWT with the requested expiry for refresh tests. */
const jwtWithExpiry = (expirySeconds: number): string =>
  `${Buffer.from('{}').toString('base64url')}.${Buffer.from(
    JSON.stringify({ exp: expirySeconds }),
  ).toString('base64url')}.signature`

/** Persists one plaintext ChatGPT credential document in the isolated test directory. */
const writeAuth = async (accessToken: string, refreshToken: string): Promise<void> => {
  const authRoot = join(rootPath, 'auth')
  await mkdir(authRoot, { recursive: true })
  await writeFile(
    join(authRoot, 'chatgpt-credentials.json'),
    JSON.stringify({
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        id_token: '',
        account_id: 'account-id',
      },
    }),
    'utf8',
  )
}

describe('ChatGptAuth', () => {
  it('opens the OAuth browser before waiting for the callback code', async () => {
    /** Resolves the simulated OAuth callback after browser launch is observed. */
    let resolveCallback: (code: string) => void = () => undefined
    const callback = new Promise<{ providerId: string; code: string }>((resolve) => {
      resolveCallback = (code) => resolve({ providerId: 'chatgpt', code })
    })
    const service = new ChatGptAuth(rootPath, createLogger())
    const internals = service as unknown as {
      beginOAuthRedirect: (state: string) => Promise<{ providerId: string; code: string }>
      exchangeCode: (
        code: string,
        verifier: string,
      ) => Promise<{ tokens: Record<string, string> } | null>
    }
    internals.beginOAuthRedirect = vi.fn(() => callback)
    internals.exchangeCode = vi.fn(async () => ({
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: '',
        account_id: 'account-id',
      },
    }))

    service.startLogin('chatgpt')

    await vi.waitFor(() => expect(electronMocks.openExternal).toHaveBeenCalledOnce())
    resolveCallback('authorization-code')
    await vi.waitFor(async () => {
      expect((await service.getAuthStatus('chatgpt')).signedIn).toBe(true)
    })
    expect(internals.exchangeCode).toHaveBeenCalledWith('authorization-code', expect.any(String))
    const storedAuth = JSON.parse(
      await readFile(join(rootPath, 'auth', 'chatgpt-credentials.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(storedAuth).toMatchObject({
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id',
      },
    })
  })

  it('keeps credentials and login state isolated per provider instance', async () => {
    const service = new ChatGptAuth(rootPath, createLogger())
    const internals = service as unknown as {
      beginOAuthRedirect: (state: string) => Promise<{ providerId: string; code: string }>
      exchangeCode: (
        code: string,
        verifier: string,
      ) => Promise<{ tokens: Record<string, string> } | null>
    }
    internals.beginOAuthRedirect = vi.fn(() =>
      Promise.resolve({ providerId: 'second-provider', code: 'second-code' }),
    )
    internals.exchangeCode = vi.fn(async () => ({
      tokens: {
        access_token: 'second-access-token',
        refresh_token: 'second-refresh-token',
        id_token: '',
        account_id: 'second-account',
      },
    }))

    service.startLogin('second-provider')

    await vi.waitFor(async () => {
      expect((await service.getAuthStatus('second-provider')).signedIn).toBe(true)
    })
    expect(await service.getAuthStatus('chatgpt')).toMatchObject({ signedIn: false })
    expect(await service.getCredentials('chatgpt')).toBeNull()
    expect(await service.getCredentials('second-provider')).toMatchObject({
      accessToken: 'second-access-token',
      accountId: 'second-account',
    })
    const stored = JSON.parse(
      await readFile(join(rootPath, 'auth', 'chatgpt-credentials-second-provider.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(stored).toMatchObject({
      tokens: { access_token: 'second-access-token', account_id: 'second-account' },
    })

    await service.logout('chatgpt')
    expect(await service.getAuthStatus('second-provider')).toMatchObject({ signedIn: true })
    await service.logout('second-provider')
    expect(await service.getAuthStatus('second-provider')).toMatchObject({ signedIn: false })
  })

  it('uses the refresh token before returning expired credentials', async () => {
    const expired = jwtWithExpiry(Math.floor(Date.now() / 1_000) - 60)
    const fresh = jwtWithExpiry(Math.floor(Date.now() / 1_000) + 3_600)
    await writeAuth(expired, 'stored-refresh-token')
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ access_token: fresh, refresh_token: 'rotated-refresh-token' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new ChatGptAuth(rootPath, createLogger())

    await expect(service.getCredentials('chatgpt')).resolves.toEqual({
      accessToken: fresh,
      accountId: 'account-id',
    })
    const refreshRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(refreshRequest.body))).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'stored-refresh-token',
    })
    const stored = JSON.parse(
      await readFile(join(rootPath, 'auth', 'chatgpt-credentials.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(stored).toMatchObject({
      tokens: { access_token: fresh, refresh_token: 'rotated-refresh-token' },
    })
  })

  it('refreshes and retries once after a ChatGPT request returns 401', async () => {
    const current = jwtWithExpiry(Math.floor(Date.now() / 1_000) + 3_600)
    const refreshed = jwtWithExpiry(Math.floor(Date.now() / 1_000) + 7_200)
    await writeAuth(current, 'stored-refresh-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: refreshed }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const request = vi
      .fn<(credentials: ChatGptCredentials) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const service = new ChatGptAuth(rootPath, createLogger())

    const response = await service.fetchWithCredentials('chatgpt', request)

    expect(response.status).toBe(200)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[0].accessToken).toBe(current)
    expect(request.mock.calls[1]?.[0].accessToken).toBe(refreshed)
  })
})
