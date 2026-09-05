/** Defines provider configuration, model catalogs, authentication state, and usage models. */

import type { ReasoningEffort } from './reasoning'

/** Lists every provider protocol family: OpenAI-compatible REST and the web-login families. */
export const PROVIDER_TYPES = ['openai-compatible', 'chatgpt', 'claude-web'] as const

/** Identifies one provider protocol family. */
export type ProviderType = (typeof PROVIDER_TYPES)[number]

/** Lists the reasoning controls offered by every OpenAI-compatible provider. */
export const OPENAI_COMPATIBLE_REASONING_EFFORTS: ReasoningEffort[] = [
  'off',
  'default',
  'low',
  'medium',
  'high',
  'xhigh',
]

/**
 * Resolves reasoning controls from the provider family and server-supplied catalog
 * metadata. OpenAI-compatible providers always offer the fixed list; server levels
 * absent from it (e.g. OpenRouter `max`) are appended at the end.
 */
export const getProviderReasoningEfforts = (
  providerType: ProviderType | undefined,
  serverEfforts: ReasoningEffort[] | undefined,
): ReasoningEffort[] => {
  if (providerType !== 'openai-compatible') return [...(serverEfforts ?? [])]
  const extras = [...new Set(serverEfforts ?? [])].filter(
    (effort) => !OPENAI_COMPATIBLE_REASONING_EFFORTS.includes(effort),
  )
  return [...OPENAI_COMPATIBLE_REASONING_EFFORTS, ...extras]
}

/** A stable provider/model pair that remains unambiguous across catalogs. */
export interface ModelReference {
  providerId: string
  modelId: string
}

/** Public provider data used by the ordered overview. */
export interface ProviderSummary {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  batchUrl?: string | undefined
  batchPollIntervalSeconds?: number | undefined
  batchModelRegex?: string | undefined
  customHeaders?: Record<string, string> | undefined
  builtin: boolean
  enabled: boolean
  hasApiKey: boolean
  modelCount: number
}

/** Capability flags reported or inferred for one provider model. */
export interface ModelCapabilities {
  chat: boolean
  vision: boolean
  imageGeneration: boolean
  reasoning: boolean
}

/** One persisted provider model definition before provider qualification and favorite state. */
export interface ProviderModelDefinition {
  modelId: string
  name: string
  group: string
  ownedBy?: string | undefined
  capabilities: ModelCapabilities
  reasoningEfforts?: ReasoningEffort[] | undefined
}

/** Connection fields used to fetch a provider catalog from the current edit form. */
export interface ProviderConnectionInput {
  id?: string | undefined
  type: ProviderType
  name: string
  baseUrl?: string | undefined
  batchUrl?: string | undefined
  batchPollIntervalSeconds?: number | undefined
  batchModelRegex?: string | undefined
  apiKey?: string | undefined
  customHeaders?: Record<string, string> | undefined
}

/** Input accepted when adding or editing a provider. */
export interface ProviderInput extends ProviderConnectionInput {
  catalogModels: ProviderModelDefinition[]
  selectedModelIds: string[]
}

/** Complete editable provider state, including the retrievable plaintext API key. */
export interface ProviderEditorData extends ProviderConnectionInput {
  id: string
  catalogModels: ProviderModelDefinition[]
  selectedModelIds: string[]
}

/** One model returned by a provider model endpoint. */
export interface ModelDescriptor extends ModelReference, ProviderModelDefinition {
  favorite: boolean
}

/** Complete provider configuration state needed by settings and chat selectors. */
export interface ProviderSnapshot {
  providers: ProviderSummary[]
  models: ModelDescriptor[]
  catalogModels: ModelDescriptor[]
  favorites: ModelReference[]
  lastUsedModel: ModelReference | null
  quickModel: ModelReference | null
  titleGenerationEnabled: boolean
}

/** One rate-limit window reported by a usage endpoint. */
export interface ProviderUsageWindow {
  label: string
  percent: number
  resetAt: number
}

/** Rate-limit state for one login-based provider account. */
export interface ProviderUsageState {
  plan: string
  windows: ProviderUsageWindow[]
  fetchedAt: number
}

/** Renderer-safe authentication state for one login-based provider. */
export interface ProviderAuthStatus {
  providerId: string
  signedIn: boolean
  signingIn: boolean
  accountEmail: string
  plan: string
  hasRefreshToken: boolean
  expiresAt?: number | undefined
  error?: string | undefined
}
