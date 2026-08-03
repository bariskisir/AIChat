/**
 * Qualifies raw catalog models with capability flags, display groups, and reasoning efforts.
 */

import { REASONING_EFFORTS, type ModelDescriptor, type ReasoningEffort } from '@shared/index'
import { getModelSupportedReasoningEffortOptions, isReasoningModel } from '../reasoning/index'

/** Supplies a stable family label to catalogs migrated before model groups were persisted. */
export const inferModelGroup = (modelId: string, ownedBy?: string): string => {
  const pathOwner = modelId.includes('/') ? modelId.split('/')[0] : undefined
  if (pathOwner) return pathOwner
  if (ownedBy?.trim()) return ownedBy.trim()
  const id = modelId.toLowerCase()
  if (/claude/.test(id)) return 'Anthropic'
  if (/^(gpt|chatgpt|o\d|text-|dall-e)/.test(id)) return 'OpenAI'
  if (/gemini|gemma/.test(id)) return 'Google'
  if (/deepseek/.test(id)) return 'DeepSeek'
  if (/qwen|qwq/.test(id)) return 'Qwen'
  if (/llama/.test(id)) return 'Meta'
  if (/mistral|mixtral|codestral/.test(id)) return 'Mistral'
  return 'Other'
}

/** Returns model capabilities using conservative OpenAI-compatible naming conventions. */
export const inferCapabilities = (
  modelId: string,
  provider?: { id?: string | undefined; name?: string | undefined; baseUrl?: string | undefined },
  modelName?: string | undefined,
): ModelDescriptor['capabilities'] => {
  const id = modelId.toLowerCase()
  const nonChat = /(embedding|embed-|rerank|moderation|whisper|tts|speech)/.test(id)
  return {
    chat: !nonChat && !/(dall-e|image-)/.test(id),
    vision: /(vision|vl|gpt-4o|gpt-4\.1|gemini|claude-3|claude-[4-9]|qwen.*vl)/.test(id),
    imageGeneration: /(dall-e|gpt-image|image-generation|flux)/.test(id),
    reasoning: isReasoningModel(
      { id: modelId, ...(modelName ? { name: modelName } : {}) },
      provider,
    ),
  }
}

/** Unions persisted reasoning choices with the static port so stale catalogs gain new levels. */
export const mergeReasoningEfforts = (
  stored: unknown,
  inferred: ReasoningEffort[] | undefined,
): ReasoningEffort[] | undefined => {
  const combined: ReasoningEffort[] = []
  /** Adds one valid effort without duplicating earlier values. */
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return
    if (!REASONING_EFFORTS.includes(value as ReasoningEffort)) return
    if (!combined.includes(value as ReasoningEffort)) combined.push(value as ReasoningEffort)
  }
  if (Array.isArray(stored)) for (const value of stored) push(value)
  inferred?.forEach(push)
  if (combined.length === 0) return undefined
  if (!combined.includes('default')) return combined
  return ['default', ...combined.filter((value) => value !== 'default')]
}

/** Builds reasoning choices from explicit metadata and known model families. */
export const inferReasoningEffortsFromPayload = (
  raw: Record<string, unknown>,
  modelId: string,
  provider: { id?: string | undefined; name?: string | undefined; baseUrl?: string | undefined },
): ReasoningEffort[] | undefined => {
  const source = raw.reasoning_efforts ?? raw.reasoningEfforts
  if (Array.isArray(source)) {
    const valid = [
      ...new Set(
        source.flatMap((value): ReasoningEffort[] => {
          if (typeof value !== 'string') return []
          const normalized =
            value === 'none'
              ? 'off'
              : value === 'max' || value === 'extra_high' || value === 'extra-high'
                ? 'xhigh'
                : value
          return REASONING_EFFORTS.includes(normalized as ReasoningEffort)
            ? [normalized as ReasoningEffort]
            : []
        }),
      ),
    ]
    if (valid.length > 0) {
      return ['default', ...valid.filter((value) => value !== 'default')]
    }
  }
  return getModelSupportedReasoningEffortOptions(
    { id: modelId, name: typeof raw.name === 'string' ? raw.name : undefined },
    provider,
  )
}
