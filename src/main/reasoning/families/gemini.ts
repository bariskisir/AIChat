/** Gemini-family reasoning-model detection predicates. */

import { belongsToFamily } from '../familyPatterns'
import { detectProviderKind, getLowerBaseModelName } from '../reasoning.shared'
import type { ReasoningModelLike, ReasoningProviderLike } from '../reasoning.types'

/** Gemini 3.x version prefix shared by the thinking-token model aliases. */
const GEMINI_3_VERSION_PATTERN = '(?:3|3\\.\\d+)'

/** Gemini 3 flash/pro bases, optionally with the -preview marker. */
const GEMINI_3_MODEL_PATTERN = `${GEMINI_3_VERSION_PATTERN}-(?:flash|pro)(?:-preview)?`

/** Base name prefixes of every Gemini model exposing thinking-token control. */
const GEMINI_THINKING_BASES = [
  '2\\.5[^\\n]*',
  GEMINI_3_MODEL_PATTERN,
  'flash-latest',
  'pro-latest',
  'flash-lite-latest',
] as const

/** Gemini models that expose thinking-token control. */
export const GEMINI_THINKING_MODEL_REGEX = new RegExp(
  `gemini-(?:${GEMINI_THINKING_BASES.join('|')})(?:-[\\w-]+)*$`,
  'i',
)

/** Gemini flash-family models (the only ones that can hard-disable thinking). */
export const GEMINI_FLASH_MODEL_REGEX = /gemini[^\n]*-flash[^\n]*$/i

/** Google-hosted or Ollama-served Gemma 4 thinking models. */
export const isHostedGemma4ThinkingModel = (
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  const kind = detectProviderKind(provider)
  return (kind === 'gemini' || kind === 'ollama') && /^gemma-4-/.test(modelId)
}

/** Gemini models that expose thinking-token control. */
export const isSupportedThinkingTokenGeminiModel = (
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  if (!GEMINI_THINKING_MODEL_REGEX.test(modelId)) {
    return isHostedGemma4ThinkingModel(model, provider)
  }
  if (modelId.includes('image') || modelId.includes('tts')) {
    return modelId.includes('gemini-3-pro-image')
  }
  return true
}

/** Gemini 3.x models including the flash-latest / pro-latest aliases. */
export const isGemini3Model = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return (
    belongsToFamily(modelId, 'gemini3') ||
    belongsToFamily(modelId, 'geminiFlashLatest') ||
    belongsToFamily(modelId, 'geminiProLatest')
  )
}

/** Gemini 3.x models (excluding image variants) that use reasoning_effort on compatible endpoints. */
export const isGemini3ThinkingTokenModel = (model: ReasoningModelLike): boolean =>
  isGemini3Model(model) && !getLowerBaseModelName(model.id).includes('image')

/** Gemini 3.x Flash models (excluding image variants). */
export const isGemini3FlashModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  if (modelId === 'gemini-flash-latest') return true
  return /gemini-3(?:\.\d+)?-flash(?:-[\w-]+)*$/i.test(modelId) && !modelId.includes('-flash-image')
}

/** Gemini 3.1 Flash Lite models. */
export const isGemini31FlashLiteModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return /gemini-3\.1-flash-lite(?:-[\w-]+)*$/i.test(modelId)
}

/** Gemini 3 Pro models (excluding image variants). */
export const isGemini3ProModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return /gemini-3-pro(?:-[\w-]+)*$/i.test(modelId) && !modelId.includes('-pro-image')
}

/** Gemini 3.1 Pro models (excluding image variants). */
export const isGemini31ProModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  if (modelId === 'gemini-pro-latest') return true
  return /gemini-3\.1-pro(?:-[\w-]+)*$/i.test(modelId) && !modelId.includes('-pro-image')
}

/** Gemini reasoning models. */
export function isGeminiReasoningModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  if (/^gemini[\s\S]*thinking/.test(modelId)) return true
  return isSupportedThinkingTokenGeminiModel(model, provider)
}
