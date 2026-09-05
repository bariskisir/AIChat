/**
 * Qualifies raw OpenAI-compatible catalog models with capability flags and display groups.
 */

import { isReasoningEffortValue, type ModelDescriptor, type ReasoningEffort } from '@shared/index'

/** Supplies a stable family label to catalogs migrated before model groups were persisted. */
export const inferModelGroup = (modelId: string, ownedBy?: string): string => {
  const pathOwner = modelId.includes('/') ? modelId.split('/')[0] : undefined
  if (pathOwner) return pathOwner
  if (ownedBy?.trim()) return ownedBy.trim()
  return 'Other'
}

/** Normalizes one raw effort value into the portable reasoning vocabulary. */
const normalizeEffort = (value: unknown): ReasoningEffort | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized =
    value === 'none' ? 'off' : value === 'extra_high' || value === 'extra-high' ? 'xhigh' : value
  return isReasoningEffortValue(normalized) ? (normalized as ReasoningEffort) : undefined
}

/**
 * Reads server-supplied reasoning levels from one catalog entry. Only gateways
 * like OpenRouter send a `reasoning.supported_efforts` array; standard
 * OpenAI-compatible `/models` responses carry no reasoning metadata and yield
 * undefined so the fixed provider-level list applies.
 */
export const parseCatalogReasoningEfforts = (
  raw: Record<string, unknown>,
): ReasoningEffort[] | undefined => {
  const nested =
    raw.reasoning && typeof raw.reasoning === 'object' && !Array.isArray(raw.reasoning)
      ? (raw.reasoning as Record<string, unknown>).supported_efforts
      : undefined
  const source = Array.isArray(nested)
    ? nested
    : Array.isArray(raw.reasoning_efforts)
      ? raw.reasoning_efforts
      : Array.isArray(raw.reasoningEfforts)
        ? raw.reasoningEfforts
        : undefined
  if (!source) return undefined
  const efforts = [...new Set(source.flatMap((value) => normalizeEffort(value) ?? []))]
  if (efforts.length === 0) return undefined
  return ['default', ...efforts.filter((effort) => effort !== 'default')]
}

/** Returns non-reasoning model capabilities using conservative OpenAI-compatible naming conventions. */
export const inferCapabilities = (modelId: string): ModelDescriptor['capabilities'] => {
  const id = modelId.toLowerCase()
  const nonChat = /(embedding|embed|rerank|moderation|audio|speech)/.test(id)
  return {
    chat: !nonChat && !/image/.test(id),
    vision: /(vision|multimodal)/.test(id),
    imageGeneration: /image/.test(id),
    reasoning: false,
  }
}
