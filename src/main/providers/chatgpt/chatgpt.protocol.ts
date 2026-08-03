/**
 * Pure protocol helpers for the ChatGPT Codex backend: model catalogs, the Responses
 * streaming payload and parser, and the wham usage endpoint.
 */

import type {
  ProviderModelDefinition,
  ProviderUsageState,
  ProviderUsageWindow,
  ReasoningEffort,
  TokenUsage,
} from '@shared/index'
import { REASONING_EFFORTS } from '@shared/index'

/** ChatGPT OAuth and backend endpoint inventory. */
export const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CHATGPT_ORIGINATOR = 'codex_cli_rs'
export const CHATGPT_TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
export const CHATGPT_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
export const CODEX_LATEST_URL = 'https://registry.npmjs.org/@openai/codex/latest'
export const DEFAULT_CODEX_CLIENT_VERSION = '0.145.0'

type JsonObject = Record<string, unknown>

/** Guards a value as a plain object, returning null for primitives, arrays, and null. */
const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null

/** Extracts a trimmed string from unknown input, defaulting to an empty string. */
const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Extracts a string without removing stream-significant whitespace. */
const rawStringValue = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Safely parses a finite number from unknown input, returning null otherwise. */
const numericValue = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** Maps this app's effort vocabulary to the Responses API reasoning effort. */
export const mapResponsesEffort = (
  effort: ReasoningEffort,
): 'off' | 'low' | 'medium' | 'high' | 'xhigh' | null => {
  switch (effort) {
    case 'off':
      return 'off'
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
      return 'xhigh'
    default:
      return null
  }
}

/** Converts one message content value into Responses API input items. */
const buildResponsesContent = (content: unknown, role: string): Array<Record<string, unknown>> => {
  const textType = role === 'assistant' ? 'output_text' : 'input_text'
  if (typeof content === 'string') return content ? [{ type: textType, text: content }] : []
  if (!Array.isArray(content)) return []
  return content.flatMap((part): Array<Record<string, unknown>> => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return []
    const record = part as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string' && record.text) {
      return [{ type: textType, text: record.text }]
    }
    if (record.type === 'image_url') {
      const imageUrl = asObject(record.image_url)
      const url = imageUrl ? stringValue(imageUrl.url) : ''
      if (url.startsWith('data:')) return [{ type: 'input_image', image_url: url }]
    }
    return []
  })
}

/** Builds the Responses API request body for one chat completion. */
export const buildResponsesRequest = (
  messages: ReadonlyArray<{ role: string; content: string | Array<Record<string, unknown>> }>,
  modelId: string,
  reasoningEffort: ReasoningEffort,
  stream: boolean,
): Record<string, unknown> => {
  const system: string[] = []
  const input: unknown[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      if (typeof message.content === 'string' && message.content.trim()) {
        system.push(message.content.trim())
      }
      continue
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const content = buildResponsesContent(message.content, message.role)
    if (content.length > 0) {
      input.push({ type: 'message', role: message.role, content })
    }
  }
  const effort = mapResponsesEffort(reasoningEffort)
  return {
    model: modelId,
    input,
    stream,
    store: false,
    include: ['reasoning.encrypted_content'],
    instructions: system.join('\n\n').slice(0, 200_000) || '.',
    text: { verbosity: 'medium' },
    ...(effort ? { reasoning: { effort, summary: 'auto' } } : {}),
  }
}

/** Extracts the joined output text from a completed Responses payload. */
export const extractResponsesText = (response: JsonObject | undefined): string => {
  if (!response || !Array.isArray(response.output)) return ''
  const text: string[] = []
  for (const item of response.output) {
    const entry = asObject(item)
    if (!entry || !Array.isArray(entry.content)) continue
    for (const part of entry.content) {
      const value = asObject(part)?.text
      if (typeof value === 'string') text.push(value)
    }
  }
  return text.join('\n').trim()
}

/** Reads normalized token usage from a completed Responses payload. */
const parseResponsesUsage = (response: JsonObject | undefined): TokenUsage | null => {
  const usage = response ? asObject(response.usage) : null
  if (!usage) return null
  /** Reads the first available non-negative token count from the usage object. */
  const read = (...keys: string[]): number => {
    for (const key of keys) {
      const value = numericValue(usage[key])
      if (value !== null && value >= 0) return Math.floor(value)
    }
    return 0
  }
  const promptTokens = read('input_tokens', 'prompt_tokens')
  const completionTokens = read('output_tokens', 'completion_tokens')
  const totalTokens = read('total_tokens')
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return null
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || promptTokens + completionTokens,
  }
}

/** One parsed Responses SSE event with renderer-ready deltas. */
export interface ResponsesSseDelta {
  content: string
  reasoning: string
  usage: TokenUsage | null
  completedText: string | null
  error: string | null
}

/** Parses one Responses API SSE data line into content, reasoning, usage, and errors. */
export const parseResponsesSseLine = (line: string): ResponsesSseDelta | null => {
  const value = line.trim()
  if (!value.startsWith('data:')) return null
  const data = value.slice(5).trim()
  if (!data || data === '[DONE]') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    return null
  }
  const event = asObject(parsed)
  if (!event) return null
  const type = stringValue(event.type)
  if (type === 'error') {
    const message = stringValue(event.message) || 'ChatGPT returned an error.'
    return { content: '', reasoning: '', usage: null, completedText: null, error: message }
  }
  if (type.includes('output_text.delta')) {
    return {
      content: rawStringValue(event.delta),
      reasoning: '',
      usage: null,
      completedText: null,
      error: null,
    }
  }
  if (type.includes('reasoning_summary_text.delta')) {
    return {
      content: '',
      reasoning: rawStringValue(event.delta),
      usage: null,
      completedText: null,
      error: null,
    }
  }
  if (type === 'response.completed') {
    const response = asObject(event.response)
    return {
      content: '',
      reasoning: '',
      usage: parseResponsesUsage(response ?? undefined),
      completedText: extractResponsesText(response ?? undefined),
      error: null,
    }
  }
  return { content: '', reasoning: '', usage: null, completedText: null, error: null }
}

/** Normalizes the ChatGPT Codex model catalog into provider model definitions. */
export const normalizeChatGptModels = (payload: unknown): ProviderModelDefinition[] => {
  const root = asObject(payload)
  if (!root) return []
  const entries = Array.isArray(root.models)
    ? root.models
    : Array.isArray(root.data)
      ? root.data
      : []
  const seen = new Set<string>()
  const models: ProviderModelDefinition[] = []
  for (const entry of entries) {
    const model = asObject(entry)
    if (!model || model.hidden === true || model.visibility === 'hide') continue
    const modelId = stringValue(model.slug) || stringValue(model.model) || stringValue(model.id)
    if (!modelId || seen.has(modelId)) continue
    seen.add(modelId)
    const name = stringValue(model.display_name) || stringValue(model.displayName) || modelId
    const variantsSource = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels
      : Array.isArray(model.supported_reasoning_efforts)
        ? model.supported_reasoning_efforts
        : Array.isArray(model.thinking_variants)
          ? model.thinking_variants
          : []
    const reasoningEfforts = [
      ...new Set(
        variantsSource.flatMap((variant): ReasoningEffort[] => {
          const option = asObject(variant)
          const raw =
            stringValue(variant) ||
            (option
              ? stringValue(option.effort) || stringValue(option.value) || stringValue(option.name)
              : '')
          const normalized = raw === 'none' ? 'off' : raw === 'max' ? 'xhigh' : raw
          if (!normalized || !(REASONING_EFFORTS as readonly string[]).includes(normalized))
            return []
          return [normalized as ReasoningEffort]
        }),
      ),
    ]
    const inputModalities = Array.isArray(model.input_modalities) ? model.input_modalities : []
    const reasoning = reasoningEfforts.length > 0
    models.push({
      modelId,
      name,
      group: 'Codex',
      capabilities: {
        chat: true,
        vision: inputModalities.includes('image') || inputModalities.includes('images'),
        imageGeneration: false,
        reasoning,
      },
      ...(reasoning
        ? {
            reasoningEfforts: [
              'default',
              ...reasoningEfforts.filter((effort) => effort !== 'default'),
            ],
          }
        : {}),
    })
  }
  models.sort((left, right) => left.name.localeCompare(right.name))
  return models
}

const WINDOW_LABELS: Record<string, string> = {
  primary_window: 'Session',
  secondary_window: 'Weekly',
}

/** Parses the wham usage payload into plan identity and rate-limit windows. */
export const parseChatGptUsage = (payload: unknown, nowMs = Date.now()): ProviderUsageState => {
  const root = asObject(payload)
  if (!root) return { plan: '', windows: [], fetchedAt: nowMs }
  const rates = [
    asObject(root.rate_limit),
    ...(Array.isArray(root.additional_rate_limits)
      ? root.additional_rate_limits.map((item) => asObject(asObject(item)?.rate_limit))
      : []),
  ].filter((rate): rate is JsonObject => rate !== null)
  const windows: ProviderUsageWindow[] = []
  for (const rate of rates) {
    for (const key of ['primary_window', 'secondary_window']) {
      const window = asObject(rate[key])
      if (!window) continue
      const percent = numericValue(window.used_percent)
      if (percent === null) continue
      let resetAt = 0
      for (const field of ['reset_at', 'resets_at', 'reset_timestamp', 'resetAt']) {
        const value = numericValue(window[field])
        if (value !== null && value > 0) {
          resetAt = value > 10_000_000_000 ? value : value * 1_000
          break
        }
      }
      windows.push({
        label: WINDOW_LABELS[key] ?? key,
        percent: Math.min(100, Math.max(0, Math.round(percent))),
        resetAt: resetAt > nowMs ? resetAt : 0,
      })
    }
  }
  return { plan: findPlanName(root), windows, fetchedAt: nowMs }
}

/** Titles a raw plan identifier by replacing separators with spaces and capitalizing words. */
const normalizePlanName = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())

/** Recursively searches a nested object tree for a subscription plan name string. */
const findPlanName = (value: unknown, depth = 0): string => {
  if (depth > 4) return ''
  if (typeof value === 'string') return normalizePlanName(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const plan = findPlanName(item, depth + 1)
      if (plan) return plan
    }
    return ''
  }
  const object = asObject(value)
  if (!object) return ''
  for (const key of [
    'plan',
    'plan_name',
    'plan_type',
    'subscription_plan',
    'subscription_tier',
    'account_plan',
    'tier',
  ]) {
    const plan = normalizePlanName(stringValue(object[key]))
    if (plan) return plan
  }
  for (const [key, nested] of Object.entries(object)) {
    if (!/(plan|tier|subscription)/i.test(key)) continue
    const plan = findPlanName(nested, depth + 1)
    if (plan) return plan
  }
  return ''
}

let cachedClientVersion: string | null = null
/** Resolves the model-catalog client version from the npm registry once per process. */
export const getChatGptClientVersion = async (): Promise<string> => {
  if (cachedClientVersion) return cachedClientVersion
  try {
    const response = await fetch(CODEX_LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      const payload = asObject((await response.json()) as unknown)
      const version = payload ? stringValue(payload.version) : ''
      if (version) {
        cachedClientVersion = version
        return cachedClientVersion
      }
    }
  } catch {
    // Fall back to the pinned client version when the registry is unreachable.
  }
  return DEFAULT_CODEX_CLIENT_VERSION
}
