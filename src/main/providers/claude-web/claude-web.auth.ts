/**
 * Owns Claude Web login sessions: one embedded login window per provider, the persistent
 * cookie partition that authenticates every request, organization discovery, ephemeral
 * conversation lifecycle, image uploads, and completion streaming.
 */

import { BrowserWindow, session, type Session } from 'electron'
import type { ProviderAuthStatus, ProviderModelDefinition } from '@shared/index'
import type LoggerService from '../../logging/logger.service'
import { CLAUDE_ORIGIN, parseClaudeWebAccount, parseClaudeWebModels } from './claude-web.protocol'

type JsonObject = Record<string, unknown>

/** One signed-in Claude Web organization identity and its cached model catalog. */
interface ClaudeWebSessionCache {
  organizationId: string
  models: ProviderModelDefinition[]
}

/** Provides Claude Web session login, bootstrap catalogs, and authenticated requests. */
export class ClaudeWebAuth {
  private readonly loginWindows = new Map<string, BrowserWindow>()
  private readonly modelCache = new Map<string, ClaudeWebSessionCache>()

  /** Creates a Claude Web auth service for providers using persistent cookie partitions. */
  public constructor(private readonly logger: LoggerService) {}

  /** Starts the Claude Web login in an embedded sandboxed browser window. */
  public async startLogin(providerId: string): Promise<void> {
    const current = this.loginWindows.get(providerId)
    if (current && !current.isDestroyed()) {
      current.focus()
      return
    }
    const loginWindow = new BrowserWindow({
      width: 1_100,
      height: 780,
      title: 'Sign in to Claude Web',
      autoHideMenuBar: true,
      webPreferences: {
        partition: this.partition(providerId),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    this.loginWindows.set(providerId, loginWindow)
    loginWindow.once('closed', () => {
      this.loginWindows.delete(providerId)
    })
    await loginWindow.loadURL(`${CLAUDE_ORIGIN}/new`).catch((error) => {
      this.logger.warn('ClaudeWebAuth', 'Claude Web login window failed to load.', error)
      throw error
    })
  }

  /** Clears the persistent session cookies and the cached catalog for one provider. */
  public async logout(providerId: string): Promise<void> {
    this.modelCache.delete(providerId)
    await this.session(providerId).clearStorageData()
  }

  /** Returns authentication state for one Claude Web session and closes a finished login. */
  public async status(providerId: string): Promise<ProviderAuthStatus> {
    const loginWindow = this.loginWindows.get(providerId)
    const signingIn = Boolean(loginWindow && !loginWindow.isDestroyed())
    try {
      const organizationId = await this.organizationId(providerId)
      const bootstrap = await this.fetchJson(providerId, this.bootstrapUrl(organizationId))
      const account = parseClaudeWebAccount(bootstrap)
      this.modelCache.set(providerId, {
        organizationId,
        models: parseClaudeWebModels(bootstrap),
      })
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
      return {
        providerId,
        signedIn: true,
        signingIn: false,
        accountEmail: account.email,
        plan: account.plan,
        hasRefreshToken: false,
      }
    } catch {
      return {
        providerId,
        signedIn: false,
        signingIn,
        accountEmail: '',
        plan: '',
        hasRefreshToken: false,
      }
    }
  }

  /** Fetches and normalizes the Claude Web model catalog from the account bootstrap. */
  public async fetchModels(providerId: string): Promise<ProviderModelDefinition[]> {
    const organizationId = await this.organizationId(providerId)
    const bootstrap = await this.fetchJson(providerId, this.bootstrapUrl(organizationId))
    const models = parseClaudeWebModels(bootstrap)
    if (models.length === 0) throw new Error('Provider returned no models.')
    this.modelCache.set(providerId, { organizationId, models })
    return models
  }

  /** Resolves the Claude Web organization id from the signed-in session cookies. */
  public async organizationId(providerId: string): Promise<string> {
    const cookies = await this.session(providerId).cookies.get({
      url: CLAUDE_ORIGIN,
      name: 'sessionKey',
    })
    if (cookies.length === 0) throw new Error('Sign in to Claude Web first.')
    const organizations = (await this.fetchJson(
      providerId,
      `${CLAUDE_ORIGIN}/api/organizations`,
    )) as unknown
    if (!Array.isArray(organizations))
      throw new Error('Claude Web returned an invalid organization list.')
    const organization = organizations.find(
      (item): item is JsonObject =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    )
    const id = organization
      ? ((organization.uuid as unknown) ?? (organization.id as unknown))
      : undefined
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('No Claude Web organization was found for this account.')
    }
    return id
  }

  /** Creates one ephemeral Claude Web conversation. */
  public async createConversation(
    providerId: string,
    organizationId: string,
    conversationId: string,
    model: string,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.session(providerId).fetch(
      `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: '', model, uuid: conversationId }),
        signal,
      },
    )
    if (response.status !== 201) {
      throw new Error(`Could not create a Claude Web conversation (${response.status}).`)
    }
  }

  /** Deletes one ephemeral Claude Web conversation, ignoring failures. */
  public async deleteConversation(
    providerId: string,
    organizationId: string,
    conversationId: string,
  ): Promise<void> {
    await this.session(providerId)
      .fetch(
        `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations/${conversationId}`,
        { method: 'DELETE', headers: this.headers() },
      )
      .catch(() => undefined)
  }

  /** Uploads inline images and returns their Claude Web file ids. */
  public async uploadImages(
    providerId: string,
    organizationId: string,
    conversationId: string,
    images: Array<{ mediaType: string; data: string }>,
    signal: AbortSignal,
  ): Promise<string[]> {
    const files: string[] = []
    for (const [index, image] of images.entries()) {
      const form = new FormData()
      form.append(
        'file',
        new Blob([Buffer.from(image.data, 'base64')], { type: image.mediaType }),
        `image-${index + 1}.${this.imageExtension(image.mediaType)}`,
      )
      form.append('orgUuid', organizationId)
      const response = await this.session(providerId).fetch(
        `${CLAUDE_ORIGIN}/api/${encodeURIComponent(organizationId)}/upload`,
        {
          method: 'POST',
          headers: this.headers({ Referer: `${CLAUDE_ORIGIN}/chat/${conversationId}` }),
          body: form,
          signal,
        },
      )
      if (!response.ok) throw new Error(`Claude Web image upload failed (${response.status}).`)
      const result = (await response.json()) as JsonObject
      const id = result.file_uuid ?? result.uuid
      if (typeof id !== 'string' || !id) {
        throw new Error('Claude Web image upload returned no file id.')
      }
      files.push(id)
    }
    return files
  }

  /** Streams one Claude Web completion and returns the response for SSE parsing. */
  public async streamCompletion(
    providerId: string,
    organizationId: string,
    conversationId: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await this.session(providerId).fetch(
      `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations/${conversationId}/completion`,
      {
        method: 'POST',
        headers: this.headers({
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(payload),
        signal,
      },
    )
    return response
  }

  /** Resolves the persistent Claude Web session partition for one provider. */
  private partition(providerId: string): string {
    return `persist:claude-web-${providerId}`
  }

  /** Returns the sandboxed session whose cookies authenticate Claude Web requests. */
  private session(providerId: string): Session {
    return session.fromPartition(this.partition(providerId))
  }

  /** Builds browser-like Claude Web request headers. */
  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/json',
      Origin: CLAUDE_ORIGIN,
      Referer: `${CLAUDE_ORIGIN}/`,
      'anthropic-client-platform': 'web_claude_ai',
      'anthropic-client-version': '1.0.0',
      ...extra,
    }
  }

  /** Performs one authenticated Claude Web JSON request through the session cookie jar. */
  private async fetchJson(providerId: string, url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.session(providerId).fetch(url, {
      ...init,
      headers: {
        ...this.headers(),
        ...Object.fromEntries(new Headers(init?.headers).entries()),
      },
    })
    if (!response.ok) throw new Error(`Claude Web request failed (${response.status}).`)
    return response.json()
  }

  /** Builds the Claude Web bootstrap URL for one organization. */
  private bootstrapUrl(organizationId: string): string {
    return (
      `${CLAUDE_ORIGIN}/edge-api/bootstrap/${encodeURIComponent(organizationId)}/app_start` +
      '?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false'
    )
  }

  /** Maps one media type to its file extension for Claude Web uploads. */
  private imageExtension(mediaType: string): string {
    return (
      { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[
        mediaType
      ] ?? 'img'
    )
  }
}
