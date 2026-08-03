/** Grok-family reasoning-model detection predicates. */

import { belongsToFamily } from '../familyPatterns'
import { detectProviderKind, getLowerBaseModelName } from '../reasoning.shared'
import type { ReasoningModelLike, ReasoningProviderLike } from '../reasoning.types'

/** True when a Grok model id explicitly opts out of reasoning. */
const isNonReasoningVariant = (modelId: string): boolean => modelId.includes('non-reasoning')

/** Grok 4.3 models with native reasoning_effort (none/low/medium/high). */
export function isGrok43Model(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return belongsToFamily(modelId, 'grok43') && !isNonReasoningVariant(modelId)
}

/** Grok 4 Fast reasoning models (OpenRouter toggles; no effort levels). */
export function isGrok4FastReasoningModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return belongsToFamily(modelId, 'grok4fast') && !isNonReasoningVariant(modelId)
}

/** Grok models that accept reasoning_effort. */
export function isSupportedReasoningEffortGrokModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model) return false
  if (isGrok43Model(model)) return true
  const modelId = getLowerBaseModelName(model.id)
  if (belongsToFamily(modelId, 'grok3mini')) return true
  if (detectProviderKind(provider) === 'openrouter' && belongsToFamily(modelId, 'grok4fast')) {
    return true
  }
  return false
}

/** Grok reasoning models. */
export function isGrokReasoningModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return (
    isSupportedReasoningEffortGrokModel(model, provider) ||
    (belongsToFamily(modelId, 'grok4') && !isNonReasoningVariant(modelId)) ||
    belongsToFamily(modelId, 'grokBuild')
  )
}
