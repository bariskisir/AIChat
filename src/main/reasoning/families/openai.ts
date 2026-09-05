/** OpenAI-family reasoning-model detection predicates (o-series, GPT-5, GPT-6, GPT-OSS). */

import { detectProviderKind, getLowerBaseModelName } from '../reasoning.shared'
import type { ReasoningModelLike, ReasoningProviderLike } from '../reasoning.types'

/** Matches the exact word 'gpt' surrounded by non-word characters. */
const GPT_WORD_PATTERN = /(?:^|[^\w])gpt(?:$|[^\w])/

/** True when an o1 model id is not one of the legacy preview/mini variants. */
const isO1WithoutLegacyVariants = (modelId: string): boolean =>
  modelId.includes('o1') && !modelId.includes('o1-preview') && !modelId.includes('o1-mini')

/** True when the base GPT-5 series appears without a dotted sub-version. */
const hasGpt5BaseSeries = (modelId: string): boolean => {
  const marker = 'gpt-5'
  const at = modelId.indexOf(marker)
  if (at < 0) return false
  const following = modelId[at + marker.length]
  return (
    following === undefined ||
    following !== '.' ||
    !/\d/.test(modelId[at + marker.length + 1] ?? '')
  )
}

/** GPT-family models including reasoning o-series. */
export const isOpenAIModel = (model: ReasoningModelLike): boolean =>
  GPT_WORD_PATTERN.test(getLowerBaseModelName(model.id)) || isOpenAIReasoningModel(model)

/** OpenAI reasoning models (o1 without preview/mini, o3, o4, gpt-oss, non-chat GPT-5/6). */
export const isSupportedReasoningEffortOpenAIModel = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return (
    isO1WithoutLegacyVariants(modelId) ||
    /o[34]/.test(modelId) ||
    /gpt-oss/.test(modelId) ||
    (isGPT5FamilyModel(model) && !modelId.includes('chat')) ||
    (isGPT6FamilyModel(model) && !modelId.includes('chat'))
  )
}

/** OpenAI reasoning-model detection. */
export const isOpenAIReasoningModel = (model: ReasoningModelLike): boolean =>
  isSupportedReasoningEffortOpenAIModel(model) || /o1/.test(getLowerBaseModelName(model.id, '/'))

/** GPT-OSS open-weight models (reasoning_effort strings accepted by Ollama's think param). */
export const isOpenAIOpenWeightModel = (model: ReasoningModelLike): boolean =>
  /gpt-oss/.test(getLowerBaseModelName(model.id))

/** GPT-5 pro models. */
export const isGPT5ProModel = (model: ReasoningModelLike): boolean =>
  /gpt-5-pro/.test(getLowerBaseModelName(model.id))

/** GPT-5.2 pro models. */
export const isGPT52ProModel = (model: ReasoningModelLike): boolean =>
  /gpt-5\.2-pro/.test(getLowerBaseModelName(model.id))

/** GPT-5.1 codex-max models. */
export const isGPT51CodexMaxModel = (model: ReasoningModelLike): boolean =>
  /gpt-5\.1-codex-max/.test(getLowerBaseModelName(model.id))

/** GPT-5 base series (gpt-5, gpt-5-pro; excludes sub-versions). */
export const isGPT5SeriesModel = (model: ReasoningModelLike): boolean =>
  hasGpt5BaseSeries(getLowerBaseModelName(model.id))

/** GPT-5 family (gpt-5, gpt-5.1, gpt-5.2, etc.). */
export const isGPT5FamilyModel = (model: ReasoningModelLike): boolean =>
  /gpt-5/.test(getLowerBaseModelName(model.id))

/** GPT-5.1 series models. */
export const isGPT51SeriesModel = (model: ReasoningModelLike): boolean =>
  /gpt-5\.1/.test(getLowerBaseModelName(model.id))

/** GPT-5.2 series models. */
export const isGPT52SeriesModel = (model: ReasoningModelLike): boolean =>
  /gpt-5\.2/.test(getLowerBaseModelName(model.id))

/** GPT-6 family (gpt-6, gpt-6-astra, future gpt-6.x variants). */
export const isGPT6FamilyModel = (model: ReasoningModelLike): boolean =>
  /gpt-6/.test(getLowerBaseModelName(model.id))

/** GPT-5.x models that accept reasoning_effort 'none' (GPT-6 never does: API returns 400). */
export function isSupportNoneReasoningEffortModel(model: ReasoningModelLike): boolean {
  if (isGPT6FamilyModel(model)) return false
  const modelId = getLowerBaseModelName(model.id)
  if (!isGPT5FamilyModel(model) || isGPT5SeriesModel(model)) return false
  if (modelId.includes('chat') || modelId.includes('pro')) return false
  const isOldCodex =
    modelId.includes('codex') && (isGPT51SeriesModel(model) || isGPT52SeriesModel(model))
  return !isOldCodex
}

/** OpenAI deep-research models (official OpenAI providers only). */
export function isOpenAIDeepResearchModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model) return false
  if (detectProviderKind(provider) !== 'openai') return false
  return /deep[_\s-]*research/i.test(getLowerBaseModelName(model.id, '/'))
}
