/** Aggregated reasoning-model detection over every model family. */

import { isClaudeReasoningModel, isSupportedThinkingTokenClaudeModel } from './families/claude'
import {
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenDeepSeekModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenKimiModel,
  isSupportedThinkingTokenMiMoModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  isBaichuanReasoningModel,
  isDeepSeekHybridInferenceModel,
  isHunyuanReasoningModel,
  isKimiReasoningModel,
  isLingReasoningModel,
  isMiniMaxM3Model,
  isMiniMaxReasoningModel,
  isMiMoReasoningModel,
  isQwenReasoningModel,
  isStepReasoningModel,
  isZhipuReasoningModel,
} from './families/chinese'
import { isSupportedThinkingTokenGeminiModel, isGeminiReasoningModel } from './families/gemini'
import { isGrokReasoningModel, isSupportedReasoningEffortGrokModel } from './families/grok'
import {
  isPerplexityReasoningModel,
  isSupportedReasoningEffortPerplexityModel,
  isMistralReasoningModel,
  isEmbeddingModel,
  isRerankModel,
  isTextToImageModel,
} from './families/misc'
import { isOpenAIReasoningModel, isSupportedReasoningEffortOpenAIModel } from './families/openai'
import { getLowerBaseModelName, REASONING_REGEX, withModelIdAndNameAsId } from './reasoning.shared'
import type { ReasoningModelLike, ReasoningProviderLike } from './reasoning.types'
import { detectProviderKind } from './reasoning.shared'

/** True when the model exposes any form of reasoning behavior. */
export function isReasoningModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }
  if (model.supportsThinking === true) return true
  const modelId = getLowerBaseModelName(model.id)
  const kind = detectProviderKind(provider)
  if (kind === 'doubao' || modelId.includes('doubao')) {
    return (
      REASONING_REGEX.test(modelId) ||
      REASONING_REGEX.test(model.name ?? '') ||
      isSupportedThinkingTokenDoubaoModel(model) ||
      isDeepSeekHybridInferenceModel(model)
    )
  }
  return (
    isClaudeReasoningModel(model) ||
    isOpenAIReasoningModel(model) ||
    isGeminiReasoningModel(model, provider) ||
    isQwenReasoningModel(model) ||
    isGrokReasoningModel(model, provider) ||
    isHunyuanReasoningModel(model) ||
    isPerplexityReasoningModel(model) ||
    isZhipuReasoningModel(model) ||
    isStepReasoningModel(model) ||
    isDeepSeekHybridInferenceModel(model) ||
    isLingReasoningModel(model) ||
    isMiniMaxReasoningModel(model) ||
    isMiMoReasoningModel(model) ||
    isBaichuanReasoningModel(model) ||
    isKimiReasoningModel(model) ||
    modelId.includes('magistral') ||
    modelId.includes('mistral-small-2603') ||
    modelId.includes('pangu-pro-moe') ||
    modelId.includes('seed-oss') ||
    modelId.includes('deepseek-v3.2-speciale') ||
    modelId.includes('gemma-4') ||
    modelId.includes('gemma4') ||
    modelId.includes('muse-spark') ||
    REASONING_REGEX.test(modelId)
  )
}

/** Models that accept reasoning-effort parameters. */
export function isSupportedReasoningEffortModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  if (modelId.includes('muse-spark')) return true
  return (
    isSupportedReasoningEffortOpenAIModel(model) ||
    isSupportedReasoningEffortGrokModel(model, provider) ||
    isSupportedReasoningEffortPerplexityModel(model) ||
    isMistralReasoningModel(model)
  )
}

/** Models with thinking-token control. */
const isSupportedThinkingTokenModelId = (
  model: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean =>
  isSupportedThinkingTokenGeminiModel(model, provider) ||
  isSupportedThinkingTokenQwenModel(model) ||
  isSupportedThinkingTokenClaudeModel(model) ||
  isSupportedThinkingTokenDoubaoModel(model) ||
  isSupportedThinkingTokenHunyuanModel(model) ||
  isSupportedThinkingTokenZhipuModel(model) ||
  isMiniMaxM3Model(model) ||
  isSupportedThinkingTokenMiMoModel(model) ||
  isSupportedThinkingTokenKimiModel(model) ||
  isSupportedThinkingTokenDeepSeekModel(model)

/** Models that can control thinking (not necessarily via reasoning_effort). */
export function isSupportedThinkingTokenModel(
  model?: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): boolean {
  if (!model) return false
  if (model.supportsThinking === true) return true
  const [idResult, nameResult] = withModelIdAndNameAsId(model, (m) =>
    isSupportedThinkingTokenModelId(m, provider),
  )
  return idResult || nameResult
}
