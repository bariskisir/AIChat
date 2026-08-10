/**
 * Owns per-provider ChatGPT PKCE OAuth, credential persistence, token refresh,
 * model catalogs, and ChatGPT-style usage limits. Every provider instance keeps
 * its own credential document and login state; the fixed OAuth callback port
 * serializes logins app-wide while the OAuth state parameter routes each
 * authorization code back to the provider that started the login.
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { shell } from 'electron'
import type { ProviderAuthStatus, ProviderModelDefinition, ProviderUsageState } from '@shared/index'
import type LoggerService from '../../logging/logger.service'
import {
  CHATGPT_CLIENT_ID,
  CHATGPT_MODELS_URL,
  CHATGPT_ORIGINATOR,
  CHATGPT_TOKEN_URL,
  CHATGPT_USAGE_URL,
  getChatGptClientVersion,
  normalizeChatGptModels,
  parseChatGptUsage,
} from './chatgpt.protocol'
import type { ChatGptCredentials, CodexAuthFile } from './chatgpt.types'

const CHATGPT_SCOPE = 'openid profile email offline_access'
const CHATGPT_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const OAUTH_REDIRECT_URL = 'http://localhost:1455/auth/callback'
const OAUTH_TIMEOUT_MS = 3 * 60 * 1_000
const EXPIRY_BUFFER_MS = 5 * 60 * 1_000

type JsonObject = Record<string, unknown>

/** Reads one nested string claim without trusting JWT contents for authorization. */
const readJwtClaim = (token: string, path: string[]): string => {
  try {
    let value: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as unknown
    for (const key of path) {
      if (!value || typeof value !== 'object') return ''
      value = (value as JsonObject)[key]
    }
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/** Reads the JWT expiry in epoch milliseconds, or 0 when the payload cannot be decoded. */
const readJwtExpiry = (token: string): number => {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as JsonObject
    const expiry = typeof payload.exp === 'number' ? payload.exp : 0
    return expiry > 0 ? expiry * 1_000 : 0
  } catch {
    return 0
  }
}

/** Titles a raw plan identifier by replacing separators with spaces and capitalizing words. */
const titlePlan = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())

/** Provides per-app ChatGPT login, token refresh, model catalogs, and usage metadata. */
export class ChatGptAuth {
  private readonly authRoot: string
  private readonly refreshPromises = new Map<string, Promise<void>>()
  private loginInProgressProviderId: string | null = null

  /** Creates a ChatGPT auth service rooted in the private AI Chat data directory. */
  public constructor(
    rootPath: string,
    private readonly logger: LoggerService,
  ) {
    this.authRoot = join(rootPath, 'auth')
  }

  /** Starts the PKCE OAuth flow in the system browser for one provider instance. */
  public startLogin(providerId: string): void {
    if (this.loginInProgressProviderId !== null) {
      throw new Error('A ChatGPT login is already in progress.')
    }
    this.loginInProgressProviderId = providerId
    void this.runLogin(providerId).finally(() => {
      if (this.loginInProgressProviderId === providerId) {
        this.loginInProgressProviderId = null
      }
    })
  }

  /** Clears the persisted ChatGPT credential document for one provider. */
  public async logout(providerId: string): Promise<void> {
    await unlink(this.credentialPath(providerId)).catch(() => undefined)
  }

  /** Returns renderer-safe authentication state for one ChatGPT provider login. */
  public async getAuthStatus(providerId: string): Promise<ProviderAuthStatus> {
    const file = await this.readAuthFile(this.credentialPath(providerId))
    return this.buildStatus(providerId, file, this.loginInProgressProviderId === providerId)
  }

  /** Fetches rate-limit usage for the ChatGPT provider account. */
  public async fetchUsage(providerId: string): Promise<ProviderUsageState> {
    const response = await this.fetchWithCredentials(providerId, (credentials) =>
      fetch(CHATGPT_USAGE_URL, {
        headers: this.chatGptHeaders(credentials.accessToken, credentials.accountId, false),
        signal: AbortSignal.timeout(30_000),
      }),
    )
    if (!response.ok) throw new Error(`Usage fetch failed with ${response.status}.`)
    return parseChatGptUsage(await response.json())
  }

  /** Fetches and normalizes the ChatGPT Codex model catalog with live credentials. */
  public async fetchModels(providerId: string): Promise<ProviderModelDefinition[]> {
    const version = await getChatGptClientVersion()
    const response = await this.fetchWithCredentials(providerId, (credentials) =>
      fetch(`${CHATGPT_MODELS_URL}?client_version=${encodeURIComponent(version)}`, {
        headers: this.chatGptHeaders(credentials.accessToken, credentials.accountId, false),
        signal: AbortSignal.timeout(30_000),
      }),
    )
    if (!response.ok) throw new Error(`Model fetch failed with ${response.status}.`)
    const models = normalizeChatGptModels(await response.json())
    if (models.length === 0) throw new Error('Provider returned no models.')
    return models
  }

  /** Resolves live credentials for one provider, refreshing the access token when needed. */
  public async getCredentials(providerId: string): Promise<ChatGptCredentials | null> {
    const filePath = this.credentialPath(providerId)
    let file = await this.readAuthFile(filePath)
    if (!file?.tokens?.access_token) return null
    const accessToken = file.tokens.access_token
    const expiry = readJwtExpiry(accessToken)
    if (file.tokens.refresh_token && expiry > 0 && Date.now() >= expiry - EXPIRY_BUFFER_MS) {
      try {
        await this.refreshTokens(filePath, file)
        file = (await this.readAuthFile(filePath)) ?? file
      } catch (error) {
        this.logger.warn('ChatGptAuth', 'ChatGPT token refresh failed.', error)
      }
    }
    return {
      accessToken: file?.tokens?.access_token ?? '',
      accountId: file?.tokens?.account_id ?? '',
    }
  }

  /** Runs an authenticated ChatGPT request and refreshes once when the server rejects the token. */
  public async fetchWithCredentials(
    providerId: string,
    request: (credentials: ChatGptCredentials) => Promise<Response>,
  ): Promise<Response> {
    let credentials = await this.getCredentials(providerId)
    if (!credentials) throw new Error('Sign in to ChatGPT first.')
    const response = await request(credentials)
    if (response.status !== 401) return response
    credentials = await this.forceRefreshCredentials(providerId)
    if (!credentials) return response
    await response.body?.cancel().catch(() => undefined)
    return request(credentials)
  }

  /** Completes one PKCE login: verifier, browser redirect, code exchange, and persistence. */
  private async runLogin(providerId: string): Promise<void> {
    const verifier = randomBytes(32).toString('base64url')
    const state = `${providerId}:${randomBytes(16).toString('base64url')}`
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    try {
      const callback = this.beginOAuthRedirect(state)
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CHATGPT_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URL,
        scope: CHATGPT_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      })
      await shell.openExternal(`${CHATGPT_AUTH_URL}?${params.toString()}`)
      const { code } = await callback
      const tokens = await this.exchangeCode(code, verifier)
      if (!tokens) throw new Error('Token exchange failed.')
      await this.writeAuthFile(this.credentialPath(providerId), tokens)
    } catch (error) {
      this.logger.warn('ChatGptAuth', 'ChatGPT sign-in failed.', error)
    }
  }

  /** Exchanges the OAuth authorization code for the credential token payload. */
  private async exchangeCode(code: string, verifier: string): Promise<CodexAuthFile | null> {
    const response = await fetch(CHATGPT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CHATGPT_CLIENT_ID,
        code,
        redirect_uri: OAUTH_REDIRECT_URL,
        code_verifier: verifier,
      }),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as JsonObject
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
    if (!accessToken) return null
    return {
      tokens: {
        access_token: accessToken,
        refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : '',
        id_token: typeof payload.id_token === 'string' ? payload.id_token : '',
        account_id: readJwtClaim(accessToken, ['https://api.openai.com/auth', 'account_id']),
      },
      last_refresh: new Date().toISOString(),
    }
  }

  /** Starts the fixed-port localhost callback server and waits for the authorization code. */
  private beginOAuthRedirect(expectedState: string): Promise<{ providerId: string; code: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        try {
          const url = new URL(request.url ?? '', OAUTH_REDIRECT_URL)
          const code = url.searchParams.get('code')
          const state = url.searchParams.get('state')
          if (state !== expectedState) {
            response.writeHead(400)
            response.end('Invalid state.')
            return
          }
          if (!code) {
            response.writeHead(400)
            response.end('No authorization code.')
            return
          }
          response.writeHead(200, { 'Content-Type': 'text/html' })
          response.end(
            '<html><body><h1>Logged in!</h1><p>You can close this window.</p></body></html>',
          )
          server.close()
          resolve({ providerId: expectedState.split(':')[0] ?? '', code })
        } catch (error) {
          response.writeHead(500)
          response.end('Internal error.')
          reject(error instanceof Error ? error : new Error('OAuth callback failed.'))
        }
      })
      const timeout = setTimeout(() => {
        server.closeAllConnections()
        server.close()
        reject(new Error('OAuth login timed out.'))
      }, OAUTH_TIMEOUT_MS)
      server.on('close', () => clearTimeout(timeout))
      server.on('error', (error) => {
        reject(error)
      })
      server.listen(1455, () => {
        // The callback port is fixed because OpenAI validates the redirect URI.
      })
    })
  }

  /** Refreshes the ChatGPT access token with the stored refresh token, once per file. */
  private refreshTokens(filePath: string, file: CodexAuthFile): Promise<void> {
    const existing = this.refreshPromises.get(filePath)
    if (existing) return existing
    const refreshToken = file.tokens?.refresh_token
    if (!refreshToken) return Promise.resolve()
    const promise = (async (): Promise<void> => {
      const response = await fetch(CHATGPT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CHATGPT_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'openid profile email',
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`Token refresh failed with ${response.status}.`)
      const payload = (await response.json()) as JsonObject
      if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new Error('Token refresh returned no access token.')
      }
      const tokens = {
        ...file.tokens,
        access_token: payload.access_token,
        ...(typeof payload.id_token === 'string' && payload.id_token
          ? { id_token: payload.id_token }
          : {}),
        ...(typeof payload.refresh_token === 'string' && payload.refresh_token
          ? { refresh_token: payload.refresh_token }
          : {}),
      }
      await this.writeAuthFile(filePath, { tokens, last_refresh: new Date().toISOString() })
    })()
    const trackedPromise = promise.finally(() => this.refreshPromises.delete(filePath))
    this.refreshPromises.set(filePath, trackedPromise)
    return trackedPromise
  }

  /** Forces one refresh-token exchange for one provider and returns the newly persisted credentials. */
  private async forceRefreshCredentials(providerId: string): Promise<ChatGptCredentials | null> {
    const filePath = this.credentialPath(providerId)
    const file = await this.readAuthFile(filePath)
    if (!file?.tokens?.access_token || !file.tokens.refresh_token) return null
    await this.refreshTokens(filePath, file)
    const refreshed = await this.readAuthFile(filePath)
    if (!refreshed?.tokens?.access_token) return null
    return {
      accessToken: refreshed.tokens.access_token,
      accountId: refreshed.tokens.account_id ?? '',
    }
  }

  /** Builds the ChatGPT status from the app-owned credential document. */
  private buildStatus(
    providerId: string,
    file: CodexAuthFile | null,
    signingIn: boolean,
  ): ProviderAuthStatus {
    const accessToken = file?.tokens?.access_token
    if (!accessToken) {
      return {
        providerId,
        signedIn: false,
        signingIn,
        accountEmail: '',
        plan: '',
        hasRefreshToken: false,
      }
    }
    const idToken = file.tokens?.id_token ?? ''
    const plan = titlePlan(
      readJwtClaim(idToken, ['https://api.openai.com/auth', 'chatgpt_plan_type']),
    )
    const email =
      readJwtClaim(idToken, ['https://api.openai.com/profile', 'email']) ||
      readJwtClaim(idToken, ['email'])
    const expiry = readJwtExpiry(accessToken)
    return {
      providerId,
      signedIn: true,
      signingIn,
      accountEmail: email,
      plan,
      hasRefreshToken: Boolean(file.tokens?.refresh_token),
      ...(expiry > 0 ? { expiresAt: expiry } : {}),
    }
  }

  /** Creates authenticated ChatGPT request headers with the Responses originator. */
  private chatGptHeaders(
    accessToken: string,
    accountId: string,
    json = true,
  ): Record<string, string> {
    return {
      Accept: json ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${accessToken}`,
      originator: CHATGPT_ORIGINATOR,
      ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
      ...(json
        ? {
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'responses=experimental',
          }
        : {}),
    }
  }

  /** Resolves the per-provider ChatGPT credential document path. */
  private credentialPath(providerId: string): string {
    if (providerId === 'chatgpt') return join(this.authRoot, 'chatgpt-credentials.json')
    return join(this.authRoot, `chatgpt-credentials-${providerId}.json`)
  }

  /** Reads one credential document, returning null when it is missing or malformed. */
  private async readAuthFile(filePath: string): Promise<CodexAuthFile | null> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const file = parsed as JsonObject
      const tokens = file.tokens
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null
      /** Reads one optional string token field from the stored credential document. */
      const read = (key: string): string =>
        typeof (tokens as JsonObject)[key] === 'string'
          ? ((tokens as JsonObject)[key] as string)
          : ''
      return {
        tokens: {
          access_token: read('access_token'),
          refresh_token: read('refresh_token'),
          id_token: read('id_token'),
          account_id: read('account_id'),
        },
        ...(typeof file.last_refresh === 'string' ? { last_refresh: file.last_refresh } : {}),
      }
    } catch {
      return null
    }
  }

  /** Atomically persists one credential document. */
  private async writeAuthFile(filePath: string, file: CodexAuthFile): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, filePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }
}
