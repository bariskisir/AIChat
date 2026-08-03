/**
 * Implements the OpenAI-compatible provider family: catalog fetches over the
 * /models endpoint with conservative capability inference.
 */

import type { ProviderConnectionInput, ProviderModelDefinition } from '@shared/index'
import { normalizeOpenAiBaseUrl } from './openai-compatible.base-url'
import type { ProviderFamily } from '../provider.family'
import {
  inferCapabilities,
  inferModelGroup,
  inferReasoningEffortsFromPayload,
} from '../model.qualification'
import type LoggerService from '../../logging/logger.service'

/** Creates a status-only API error without exposing response bodies or request credentials. */
const responseError = (response: Response): Error =>
  new Error(`Provider returned ${response.status}.`)

/** Fetches and classifies the /models catalog of one OpenAI-compatible endpoint. */
export class OpenAiCompatibleFamily implements ProviderFamily {
  public readonly type = 'openai-compatible' as const

  /** Creates the OpenAI-compatible family for one logger instance. */
  public constructor(private readonly logger: LoggerService) {}

  /** Requests, validates, de-duplicates, groups, and classifies one provider model list. */
  public async fetchCatalog(
    connection: ProviderConnectionInput,
  ): Promise<ProviderModelDefinition[]> {
    if (!connection.baseUrl) throw new Error('API URL is required for OpenAI-compatible providers.')
    const baseUrl = normalizeOpenAiBaseUrl(connection.baseUrl)
    const headers: Record<string, string> = {}
    if (connection.apiKey) {
      headers.Authorization = `Bearer ${connection.apiKey}`
      headers['x-api-key'] = connection.apiKey
    }
    this.logger.info('OpenAiCompatibleFamily', `Fetching models from ${baseUrl}/models`)
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      this.logger.warn(
        'OpenAiCompatibleFamily',
        `Model fetch failed with ${response.status}: ${body.slice(0, 500)}`,
      )
      throw responseError(response)
    }
    const payload = (await response.json()) as unknown
    const records =
      payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : Array.isArray(payload)
          ? payload
          : []
    const unique = new Map<string, ProviderModelDefinition>()
    let discoveredModel = false
    for (const item of records) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      const modelId =
        typeof raw.id === 'string' ? raw.id : typeof raw.name === 'string' ? raw.name : ''
      if (!modelId) continue
      discoveredModel = true
      const name = typeof raw.name === 'string' ? raw.name : modelId
      const ownedBy = typeof raw.owned_by === 'string' ? raw.owned_by : undefined
      const providerLike = {
        id: connection.id,
        name: connection.name,
        baseUrl: connection.baseUrl,
      }
      const capabilities = inferCapabilities(modelId, providerLike, name)
      const reasoningEfforts = inferReasoningEffortsFromPayload(raw, modelId, providerLike)
      unique.set(modelId, {
        modelId,
        name,
        group:
          typeof raw.group === 'string' && raw.group.trim()
            ? raw.group.trim()
            : inferModelGroup(modelId, ownedBy),
        ...(ownedBy ? { ownedBy } : {}),
        capabilities,
        ...(reasoningEfforts ? { reasoningEfforts } : {}),
      })
    }
    if (!discoveredModel) throw new Error('Provider returned no models.')
    return [...unique.values()].sort(
      (left, right) => left.group.localeCompare(right.group) || left.name.localeCompare(right.name),
    )
  }
}
