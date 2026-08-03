/** Builds the reasoning request-body parameters for one model and effort. */

import type { ReasoningEffort } from '@shared/index'
import { isSupportedThinkingTokenClaudeModel } from './families/claude'
import {
  isDoubaoSeed18Model,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isDeepSeekHybridInferenceModel,
  isDeepSeekV4PlusModel,
  isKimiK27CodeModel,
  isMiniMaxM3Model,
  isMiniMaxReasoningModel,
  isQwen35to39Model,
  isQwenAlwaysThinkModel,
  isQwenReasoningModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenKimiModel,
  isSupportedThinkingTokenMiMoModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
} from './families/chinese'
import {
  GEMINI_FLASH_MODEL_REGEX,
  isGemini3ThinkingTokenModel,
  isSupportedThinkingTokenGeminiModel,
} from './families/gemini'
import { isGrok4FastReasoningModel } from './families/grok'
import {
  EFFORT_RATIO,
  DEFAULT_MAX_TOKENS,
  detectProviderKind,
  getLowerBaseModelName,
  isSupportEnableThinkingProvider,
} from './reasoning.shared'
import {
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
} from './reasoning.detection'
import { findTokenLimit, getModelSupportedReasoningEffortOptions } from './reasoning.efforts'
import type {
  ReasoningModelLike,
  ReasoningProviderKind,
  ReasoningProviderLike,
} from './reasoning.types'
import {
  isOpenAIDeepResearchModel,
  isSupportNoneReasoningEffortModel,
  isOpenAIReasoningModel,
} from './families/openai'

/** Maps this app's 'off' vocabulary to the API-facing 'none' value. */
const toApiEffort = (effort: ReasoningEffort): string => (effort === 'off' ? 'none' : effort)

/** DeepSeek hybrid-inference provider-specific thinking shapes. */
const deepSeekHybridParams = (kind: ReasoningProviderKind): Record<string, unknown> => {
  switch (kind) {
    case 'dashscope':
      return { enable_thinking: true, incremental_output: true }
    case 'new-api':
      return { extra_body: { thinking: { type: 'enabled' } } }
    case 'hunyuan':
    case 'doubao':
    case 'deepseek':
      return { thinking: { type: 'enabled' } }
    case 'openrouter':
    case 'together':
      return { reasoning: { enabled: true } }
    default:
      return { thinking: { type: 'enabled' } }
  }
}

/**
 * Builds the reasoning request parameters for one model and effort, or null when nothing
 * should be sent. `extra_body` wrappers are flattened into the top-level request body
 * because this app posts raw OpenAI-compatible JSON (the AI SDK would do the same).
 */
export const buildReasoningParameters = (
  modelId: string,
  effort: ReasoningEffort,
  provider?: ReasoningProviderLike,
): Record<string, unknown> | null => {
  const model: ReasoningModelLike = { id: modelId }
  const kind = detectProviderKind(provider)

  if (kind === 'groq') return null
  if (!isReasoningModel(model, provider)) return null

  if (isMiniMaxReasoningModel(model)) {
    if (effort === 'off') return { thinking: { type: 'disabled' } }
    if (isMiniMaxM3Model(model)) return { thinking: { type: 'adaptive' } }
    return { thinking: { type: 'enabled' } }
  }

  if (isOpenAIDeepResearchModel(model, provider)) {
    return { reasoning_effort: 'medium' }
  }

  if (effort === 'default') return null

  if (effort === 'off') {
    if (kind === 'openrouter') {
      if (isSupportNoneReasoningEffortModel(model)) return { reasoning: { effort: 'none' } }
      return { reasoning: { enabled: false, exclude: true } }
    }

    if (kind === 'nvidia') {
      if (isSupportedThinkingTokenQwenModel(model)) {
        return { chat_template_kwargs: { enable_thinking: false } }
      }
      if (isDeepSeekHybridInferenceModel(model)) {
        return { chat_template_kwargs: { thinking: false } }
      }
      if (isSupportedThinkingTokenKimiModel(model)) {
        if (isKimiK27CodeModel(model)) return null
        return { chat_template_kwargs: { thinking: false } }
      }
      if (isSupportedThinkingTokenZhipuModel(model)) {
        return { chat_template_kwargs: { enable_thinking: false } }
      }
    }

    if (
      (isSupportEnableThinkingProvider(provider) &&
        (isSupportedThinkingTokenQwenModel(model) ||
          isSupportedThinkingTokenHunyuanModel(model))) ||
      (kind === 'dashscope' &&
        (isDeepSeekHybridInferenceModel(model) ||
          isSupportedThinkingTokenZhipuModel(model) ||
          (isSupportedThinkingTokenKimiModel(model) && !isKimiK27CodeModel(model)))) ||
      (kind === 'silicon' &&
        (isDeepSeekHybridInferenceModel(model) || isSupportedThinkingTokenZhipuModel(model)))
    ) {
      return { enable_thinking: false }
    }

    if (kind === 'together') {
      return { reasoning: { enabled: false } }
    }

    if (isSupportedThinkingTokenGeminiModel(model, provider)) {
      if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
        return {
          extra_body: {
            google: {
              thinking_config: {
                thinking_budget: 0,
              },
            },
          },
        }
      }
      return null
    }

    if (
      isSupportedThinkingTokenDoubaoModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenMiMoModel(model) ||
      (isSupportedThinkingTokenKimiModel(model) && !isKimiK27CodeModel(model))
    ) {
      if (kind === 'cerebras') {
        return { disable_reasoning: true }
      }
      return { thinking: { type: 'disabled' } }
    }

    if (isDeepSeekV4PlusModel(model)) {
      return { thinking: { type: 'disabled' } }
    }

    if (isDeepSeekHybridInferenceModel(model)) {
      return null
    }

    if (isSupportNoneReasoningEffortModel(model)) {
      return { reasoning_effort: 'none' }
    }

    if (isQwen35to39Model(model)) {
      return { chat_template_kwargs: { enable_thinking: false } }
    }

    if (getLowerBaseModelName(model.id).includes('mistral-small-2603')) {
      return { reasoning_effort: 'none' }
    }

    return null
  }

  if (kind === 'poe') {
    if (isOpenAIReasoningModel(model)) {
      return {
        extra_body: { reasoning_effort: effort === 'auto' ? 'medium' : toApiEffort(effort) },
      }
    }

    if (isSupportedThinkingTokenClaudeModel(model)) {
      const effortRatio = EFFORT_RATIO[effort]
      const tokenLimit = findTokenLimit(model.id)
      const maxTokens = undefined
      if (!tokenLimit) return null
      let budgetTokens = Math.floor(
        (tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min,
      )
      budgetTokens = Math.floor(
        Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio)),
      )
      return { extra_body: { thinking_budget: budgetTokens } }
    }

    if (isSupportedThinkingTokenGeminiModel(model, provider)) {
      const effortRatio = EFFORT_RATIO[effort]
      const tokenLimit = findTokenLimit(model.id)
      let budgetTokens: number | undefined
      if (tokenLimit && effort !== 'auto') {
        budgetTokens = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
      }
      return { extra_body: { thinking_budget: budgetTokens ?? -1 } }
    }

    return null
  }

  if (kind === 'openrouter') {
    if (isGrok4FastReasoningModel(model)) {
      return { reasoning: { enabled: true } }
    }
    if (
      isSupportedReasoningEffortModel(model, provider) ||
      isSupportedThinkingTokenModel(model, provider)
    ) {
      return { reasoning: { effort: effort === 'auto' ? 'medium' : toApiEffort(effort) } }
    }
  }

  const effortRatio = EFFORT_RATIO[effort]
  const tokenLimit = findTokenLimit(modelId)
  let budgetTokens: number | undefined
  if (tokenLimit) {
    budgetTokens = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  }

  if (kind === 'nvidia') {
    if (isSupportedThinkingTokenQwenModel(model)) {
      const enableThinkingConfig = isQwenAlwaysThinkModel(model) ? {} : { enable_thinking: true }
      return {
        chat_template_kwargs: {
          ...enableThinkingConfig,
          thinking_budget: budgetTokens,
        },
      }
    }
    if (isDeepSeekHybridInferenceModel(model)) {
      return { chat_template_kwargs: { thinking: true } }
    }
    if (isSupportedThinkingTokenKimiModel(model)) {
      return { chat_template_kwargs: { thinking: true } }
    }
    if (isSupportedThinkingTokenZhipuModel(model)) {
      return { chat_template_kwargs: { enable_thinking: true } }
    }
  }

  if (kind === 'silicon') {
    if (
      isDeepSeekHybridInferenceModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenQwenModel(model) ||
      isSupportedThinkingTokenHunyuanModel(model)
    ) {
      return {
        enable_thinking: true,
        thinking_budget: budgetTokens ? Math.floor(Math.max(budgetTokens, 32768)) : undefined,
      }
    }
    return null
  }

  if (isDeepSeekV4PlusModel(model)) {
    const effortValue = effort === 'xhigh' ? 'max' : 'high'
    return {
      thinking: { type: 'enabled' as const },
      reasoning_effort: effortValue,
    }
  }

  if (isDeepSeekHybridInferenceModel(model)) {
    return deepSeekHybridParams(kind)
  }

  if (kind === 'openrouter') {
    if (
      isSupportedReasoningEffortModel(model, provider) ||
      isSupportedThinkingTokenModel(model, provider)
    ) {
      return { reasoning: { effort: effort === 'auto' ? 'medium' : toApiEffort(effort) } }
    }
  }

  if (kind === 'dashscope') {
    if (
      isQwenReasoningModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenKimiModel(model)
    ) {
      if (isKimiK27CodeModel(model)) return null
      return {
        enable_thinking: true,
        thinking_budget: budgetTokens,
      }
    }
  }

  if (kind === 'together') {
    const adjustedReasoningEffort =
      effort === 'minimal'
        ? 'low'
        : effort === 'xhigh'
          ? 'high'
          : effort === 'auto'
            ? 'medium'
            : effort === 'low' || effort === 'medium' || effort === 'high'
              ? effort
              : 'medium'
    return {
      reasoning_effort: adjustedReasoningEffort,
      reasoning: { enabled: true },
    }
  }

  if (isQwenReasoningModel(model)) {
    const supportEnableThinking = isSupportEnableThinkingProvider(provider)
    const enableThinkingConfig = isQwenAlwaysThinkModel(model) ? {} : { enable_thinking: true }
    if (supportEnableThinking) {
      return {
        ...enableThinkingConfig,
        thinking_budget: budgetTokens,
      }
    }
    return {
      chat_template_kwargs: {
        ...enableThinkingConfig,
        thinking_budget: budgetTokens,
      },
    }
  }

  if (isSupportedThinkingTokenHunyuanModel(model) && isSupportEnableThinkingProvider(provider)) {
    return { enable_thinking: true }
  }

  if (isSupportedReasoningEffortModel(model, provider)) {
    const supportedOptions = getModelSupportedReasoningEffortOptions(model, provider)?.filter(
      (option) => option !== 'default',
    )
    if (supportedOptions?.includes(effort)) {
      return { reasoning_effort: toApiEffort(effort) }
    }
    const fallback = supportedOptions?.[0]
    return fallback ? { reasoning_effort: toApiEffort(fallback) } : null
  }

  if (getLowerBaseModelName(model.id).includes('mistral-small-2603')) {
    return { reasoning_effort: 'high' }
  }

  if (isSupportedThinkingTokenGeminiModel(model, provider)) {
    if (isGemini3ThinkingTokenModel(model)) {
      return { reasoning_effort: toApiEffort(effort) }
    }
    if (effort === 'auto') {
      return {
        extra_body: {
          google: {
            thinking_config: {
              thinking_budget: -1,
              include_thoughts: true,
            },
          },
        },
      }
    }
    return {
      extra_body: {
        google: {
          thinking_config: {
            thinking_budget: budgetTokens ?? -1,
            include_thoughts: true,
          },
        },
      },
    }
  }

  if (isSupportedThinkingTokenClaudeModel(model)) {
    return {
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens
          ? Math.floor(Math.max(1024, Math.min(budgetTokens, DEFAULT_MAX_TOKENS * effortRatio)))
          : undefined,
      },
    }
  }

  if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (isDoubaoSeedAfter251015(model) || isDoubaoSeed18Model(model)) {
      return { reasoning_effort: toApiEffort(effort) }
    }
    if (effort === 'high') {
      return { thinking: { type: 'enabled' } }
    }
    if (effort === 'auto' && isDoubaoThinkingAutoModel(model)) {
      return { thinking: { type: 'auto' } }
    }
    return null
  }

  if (isSupportedThinkingTokenZhipuModel(model)) {
    if (kind === 'cerebras') {
      return null
    }
    return { thinking: { type: 'enabled' } }
  }

  if (isSupportedThinkingTokenMiMoModel(model) || isSupportedThinkingTokenKimiModel(model)) {
    return { thinking: { type: 'enabled' } }
  }

  return null
}
