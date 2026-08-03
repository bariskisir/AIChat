/** Supported reasoning-effort options and thinking-token budgets per model type. */

import type { ReasoningEffort } from '@shared/index'
import {
  isClaude46SeriesModel,
  isClaudeReasoningModel,
  isSupportAdaptiveThinkingClaudeModel,
} from './families/claude'
import {
  isDoubaoSeed18Model,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenKimiModel,
  isSupportedThinkingTokenMiMoModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  isDeepSeekHybridInferenceModel,
  isDeepSeekV4PlusModel,
  isKimiK27CodeModel,
  isMiniMaxM3Model,
} from './families/chinese'
import {
  GEMINI_FLASH_MODEL_REGEX,
  isGemini31FlashLiteModel,
  isGemini31ProModel,
  isGemini3FlashModel,
  isGemini3ProModel,
  isHostedGemma4ThinkingModel,
  isSupportedThinkingTokenGeminiModel,
} from './families/gemini'
import {
  isGrok43Model,
  isGrok4FastReasoningModel,
  isSupportedReasoningEffortGrokModel,
} from './families/grok'
import { isMistralReasoningModel, isSupportedReasoningEffortPerplexityModel } from './families/misc'
import {
  isGPT5ProModel,
  isGPT51CodexMaxModel,
  isGPT51SeriesModel,
  isGPT52SeriesModel,
  isGPT5FamilyModel,
  isGPT5SeriesModel,
  isOpenAIDeepResearchModel,
  isOpenAIOpenWeightModel,
  isSupportedReasoningEffortOpenAIModel,
} from './families/openai'
import { EFFORT_RATIO, getLowerBaseModelName, withModelIdAndNameAsId } from './reasoning.shared'
import {
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
} from './reasoning.detection'
import type { ReasoningModelLike, ReasoningProviderLike } from './reasoning.types'

/** Supported reasoning-effort values per model type. */
export const MODEL_SUPPORTED_REASONING_EFFORT = {
  default: ['low', 'medium', 'high'] as const,
  o: ['low', 'medium', 'high'] as const,
  openai_deep_research: ['medium'] as const,
  gpt5: ['minimal', 'low', 'medium', 'high'] as const,
  gpt5_codex: ['low', 'medium', 'high'] as const,
  gpt5_1: ['none', 'low', 'medium', 'high'] as const,
  gpt5_1_codex: ['medium', 'high'] as const,
  gpt5_1_codex_max: ['medium', 'high', 'xhigh'] as const,
  gpt5_2_codex: ['low', 'medium', 'high', 'xhigh'] as const,
  gpt5_2: ['none', 'low', 'medium', 'high', 'xhigh'] as const,
  gpt5pro: ['high'] as const,
  gpt52pro: ['medium', 'high', 'xhigh'] as const,
  gpt_oss: ['low', 'medium', 'high'] as const,
  grok: ['low', 'high'] as const,
  grok4_fast: ['auto'] as const,
  grok_4_3: ['none', 'low', 'medium', 'high'] as const,
  gemini2_flash: ['low', 'medium', 'high', 'auto'] as const,
  gemini2_pro: ['low', 'medium', 'high', 'auto'] as const,
  gemini3_flash: ['minimal', 'low', 'medium', 'high'] as const,
  gemini3_pro: ['low', 'high'] as const,
  gemini3_1_pro: ['low', 'medium', 'high'] as const,
  gemma4_hosted: ['minimal', 'high'] as const,
  qwen: ['low', 'medium', 'high'] as const,
  qwen_thinking: ['low', 'medium', 'high'] as const,
  doubao: ['auto', 'high'] as const,
  doubao_no_auto: ['high'] as const,
  doubao_after_251015: ['minimal', 'low', 'medium', 'high'] as const,
  minimax_m3: ['auto'] as const,
  hunyuan: ['auto'] as const,
  mimo: ['auto'] as const,
  zhipu: ['auto'] as const,
  perplexity: ['low', 'medium', 'high'] as const,
  deepseek_hybrid: ['auto'] as const,
  deepseek_v4: ['high', 'xhigh'] as const,
  kimi_k2_5: ['none', 'auto'] as const,
  kimi_always_think: ['auto'] as const,
  claude: ['low', 'medium', 'high'] as const,
  claude46: ['low', 'medium', 'high', 'xhigh'] as const,
  mistral: ['high'] as const,
}

/** Full effort-option list per model type, including 'default' and 'none'. */
export const MODEL_SUPPORTED_OPTIONS = {
  default: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.default] as const,
  o: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.o] as const,
  openai_deep_research: [
    'default',
    ...MODEL_SUPPORTED_REASONING_EFFORT.openai_deep_research,
  ] as const,
  gpt5: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5] as const,
  gpt5pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5pro] as const,
  gpt5_codex: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_codex] as const,
  gpt5_1: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1] as const,
  gpt5_1_codex: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1_codex] as const,
  gpt5_2_codex: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_2_codex] as const,
  gpt5_2: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_2] as const,
  gpt5_1_codex_max: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1_codex_max] as const,
  gpt52pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt52pro] as const,
  gpt_oss: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt_oss] as const,
  grok: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.grok] as const,
  grok4_fast: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.grok4_fast] as const,
  grok_4_3: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.grok_4_3] as const,
  gemini2_flash: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini2_flash] as const,
  gemini2_pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini2_pro] as const,
  gemini3_flash: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini3_flash] as const,
  gemini3_pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini3_pro] as const,
  gemini3_1_pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini3_1_pro] as const,
  gemma4_hosted: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemma4_hosted] as const,
  qwen: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.qwen] as const,
  qwen_thinking: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.qwen_thinking] as const,
  doubao: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao] as const,
  doubao_no_auto: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao_no_auto] as const,
  doubao_after_251015: [
    'default',
    ...MODEL_SUPPORTED_REASONING_EFFORT.doubao_after_251015,
  ] as const,
  minimax_m3: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.minimax_m3] as const,
  mimo: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.mimo] as const,
  hunyuan: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.hunyuan] as const,
  zhipu: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.zhipu] as const,
  perplexity: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.perplexity] as const,
  deepseek_hybrid: [
    'default',
    'none',
    ...MODEL_SUPPORTED_REASONING_EFFORT.deepseek_hybrid,
  ] as const,
  deepseek_v4: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.deepseek_v4] as const,
  kimi_k2_5: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.kimi_k2_5] as const,
  kimi_always_think: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.kimi_always_think] as const,
  claude: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.claude] as const,
  claude46: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.claude46] as const,
  mistral: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.mistral] as const,
}

/** Thinking-model-type vocabulary used for effort-option lookups. */
type ThinkModelType = keyof typeof MODEL_SUPPORTED_OPTIONS

/** Classifies one model into the provider-specific reasoning parameter family it accepts. */
const getThinkModelTypeId = (
  model: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): ThinkModelType => {
  let thinkingModelType: ThinkModelType = 'default'
  const modelId = getLowerBaseModelName(model.id)
  if (isClaudeReasoningModel(model)) {
    thinkingModelType = 'claude'
    if (isClaude46SeriesModel(model) || isSupportAdaptiveThinkingClaudeModel(model)) {
      thinkingModelType = 'claude46'
    }
  } else if (isOpenAIDeepResearchModel(model, provider)) {
    return 'openai_deep_research'
  } else if (isGPT5FamilyModel(model)) {
    if (isGPT51SeriesModel(model)) {
      if (modelId.includes('codex')) {
        thinkingModelType = 'gpt5_1_codex'
        if (isGPT51CodexMaxModel(model)) {
          thinkingModelType = 'gpt5_1_codex_max'
        }
      } else {
        thinkingModelType = 'gpt5_1'
      }
    } else if (isGPT52SeriesModel(model) && modelId.includes('codex')) {
      thinkingModelType = 'gpt5_2_codex'
    } else if (isGPT5SeriesModel(model)) {
      if (modelId.includes('codex')) {
        thinkingModelType = 'gpt5_codex'
      } else {
        thinkingModelType = 'gpt5'
        if (isGPT5ProModel(model)) {
          thinkingModelType = 'gpt5pro'
        }
      }
    } else {
      if (modelId.includes('-pro')) {
        thinkingModelType = 'gpt52pro'
      } else {
        thinkingModelType = 'gpt5_2'
      }
    }
  } else if (isOpenAIOpenWeightModel(model)) {
    thinkingModelType = 'gpt_oss'
  } else if (isSupportedReasoningEffortOpenAIModel(model)) {
    thinkingModelType = 'o'
  } else if (isGrok43Model(model)) {
    thinkingModelType = 'grok_4_3'
  } else if (isGrok4FastReasoningModel(model)) {
    thinkingModelType = 'grok4_fast'
  } else if (isSupportedThinkingTokenGeminiModel(model, provider)) {
    if (isHostedGemma4ThinkingModel(model, provider)) {
      thinkingModelType = 'gemma4_hosted'
    } else if (isGemini3FlashModel(model) || isGemini31FlashLiteModel(model)) {
      thinkingModelType = 'gemini3_flash'
    } else if (isGemini3ProModel(model)) {
      thinkingModelType = 'gemini3_pro'
    } else if (isGemini31ProModel(model)) {
      thinkingModelType = 'gemini3_1_pro'
    } else if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
      thinkingModelType = 'gemini2_flash'
    } else {
      thinkingModelType = 'gemini2_pro'
    }
  } else if (isSupportedReasoningEffortGrokModel(model, provider)) {
    thinkingModelType = 'grok'
  } else if (isSupportedThinkingTokenQwenModel(model)) {
    thinkingModelType = 'qwen'
  } else if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (isDoubaoThinkingAutoModel(model)) {
      thinkingModelType = 'doubao'
    } else if (isDoubaoSeedAfter251015(model) || isDoubaoSeed18Model(model)) {
      thinkingModelType = 'doubao_after_251015'
    } else {
      thinkingModelType = 'doubao_no_auto'
    }
  } else if (isMiniMaxM3Model(model)) {
    thinkingModelType = 'minimax_m3'
  } else if (isSupportedThinkingTokenHunyuanModel(model)) {
    thinkingModelType = 'hunyuan'
  } else if (isSupportedReasoningEffortPerplexityModel(model)) {
    thinkingModelType = 'perplexity'
  } else if (isSupportedThinkingTokenZhipuModel(model)) {
    thinkingModelType = 'zhipu'
  } else if (isDeepSeekV4PlusModel(model)) {
    thinkingModelType = 'deepseek_v4'
  } else if (isDeepSeekHybridInferenceModel(model)) {
    thinkingModelType = 'deepseek_hybrid'
  } else if (isSupportedThinkingTokenMiMoModel(model)) {
    thinkingModelType = 'mimo'
  } else if (isSupportedThinkingTokenKimiModel(model)) {
    thinkingModelType = isKimiK27CodeModel(model) ? 'kimi_always_think' : 'kimi_k2_5'
  } else if (isMistralReasoningModel(model)) {
    thinkingModelType = 'mistral'
  }
  return thinkingModelType
}

/** Resolves a model's thinking type with id/name fallback. */
export const getThinkModelType = (
  model: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): ThinkModelType => {
  const [idResult, nameResult] = withModelIdAndNameAsId(model, (m) =>
    getThinkModelTypeId(m, provider),
  )
  if (idResult !== 'default') return idResult
  return nameResult
}

/** Returns the explicit reasoning-effort options supported by one model. */
const getModelSupportedReasoningEffortOptionsId = (
  model: ReasoningModelLike,
  provider?: ReasoningProviderLike,
): string[] | undefined => {
  if (
    !isSupportedReasoningEffortModel(model, provider) &&
    !isSupportedThinkingTokenModel(model, provider)
  ) {
    return undefined
  }
  const thinkingType = getThinkModelTypeId(model, provider)
  return [...MODEL_SUPPORTED_OPTIONS[thinkingType]]
}

/**
 * Returns the supported reasoning-effort options for a model, or undefined when the
 * model exposes no thinking control. 'none' is mapped to this app's 'off' vocabulary.
 */
export const getModelSupportedReasoningEffortOptions = (
  model: ReasoningModelLike | undefined | null,
  provider?: ReasoningProviderLike,
): ReasoningEffort[] | undefined => {
  if (!model) return undefined
  const [idResult, nameResult] = withModelIdAndNameAsId(model, (m) =>
    getModelSupportedReasoningEffortOptionsId(m, provider),
  )
  const options = idResult ?? nameResult
  if (!options) return undefined
  return options.map((option): ReasoningEffort =>
    option === 'none' ? 'off' : (option as ReasoningEffort),
  )
}

/** One model-id pattern with its thinking-token budget range. */
type ThinkingTokenLimit = { pattern: string; min: number; max: number }

/** Gemini-family thinking-token budget ranges. */
const GEMINI_TOKEN_LIMITS: ReadonlyArray<ThinkingTokenLimit> = [
  { pattern: 'gemini-2\\.5-flash-lite.*$', min: 512, max: 24576 },
  { pattern: 'gemini-.*-flash.*$', min: 0, max: 24576 },
  { pattern: 'gemini-.*-pro.*$', min: 128, max: 32768 },
]

/** Qwen-family thinking-token budget ranges. */
const QWEN_TOKEN_LIMITS: ReadonlyArray<ThinkingTokenLimit> = [
  { pattern: 'qwen3-235b-a22b-thinking-2507$', min: 0, max: 81_920 },
  { pattern: 'qwen3-30b-a3b-thinking-2507$', min: 0, max: 81_920 },
  { pattern: 'qwen3-vl-235b-a22b-thinking$', min: 0, max: 81_920 },
  { pattern: 'qwen3-vl-30b-a3b-thinking$', min: 0, max: 81_920 },
  { pattern: 'qwen-plus-2025-07-14$', min: 0, max: 38_912 },
  { pattern: 'qwen-plus-2025-04-28$', min: 0, max: 38_912 },
  { pattern: 'qwen3-1\\.7b$', min: 0, max: 30_720 },
  { pattern: 'qwen3-0\\.6b$', min: 0, max: 30_720 },
  { pattern: 'qwen-plus.*$', min: 0, max: 81_920 },
  { pattern: 'qwen-turbo.*$', min: 0, max: 38_912 },
  { pattern: 'qwen-flash.*$', min: 0, max: 81_920 },
  { pattern: 'qwen3-max(-.*)?$', min: 0, max: 81_920 },
  { pattern: '^qwen3\\.[5-9]', min: 0, max: 81_920 },
  { pattern: 'qwen3-(?!max).*$', min: 1024, max: 38_912 },
]

/** Claude-family thinking-token budget ranges. */
const CLAUDE_TOKEN_LIMITS: ReadonlyArray<ThinkingTokenLimit> = [
  {
    pattern: '(?:anthropic\\.)?claude-opus-4[.-](?:[7-9]|[1-9]\\d)(?:[@\\-:][\\w\\-:]+)?$',
    min: 1024,
    max: 128_000,
  },
  {
    pattern: '(?:anthropic\\.)?claude-opus-4[.-]6(?:[@\\-:][\\w\\-:]+)?$',
    min: 1024,
    max: 128_000,
  },
  {
    pattern: '(?:anthropic\\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\\d+:\\d+)?$',
    min: 1024,
    max: 64_000,
  },
  {
    pattern: '(?:anthropic\\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\\d+:\\d+)?$',
    min: 1024,
    max: 64_000,
  },
  { pattern: '(?:anthropic\\.)?claude-opus-4[.-]1.*(?:-v\\d+:\\d+)?$', min: 1024, max: 32_000 },
  {
    pattern:
      '(?:anthropic\\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
    min: 1024,
    max: 64_000,
  },
  {
    pattern:
      '(?:anthropic\\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
    min: 1024,
    max: 32_000,
  },
  { pattern: '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$', min: 1024, max: 64_000 },
]

/** Remaining model families with thinking-token budget ranges. */
const OTHER_TOKEN_LIMITS: ReadonlyArray<ThinkingTokenLimit> = [
  { pattern: 'baichuan-m2$', min: 0, max: 30_000 },
  { pattern: 'baichuan-m3$', min: 0, max: 30_000 },
  { pattern: 'gemma-?4[:-]?e[24]b', min: 1024, max: 8192 },
  { pattern: 'gemma-?4[:-]?26b', min: 1024, max: 30720 },
  { pattern: 'gemma-?4[:-]?31b', min: 1024, max: 30720 },
]

/** All thinking-token budget ranges in first-match priority order. */
const THINKING_TOKEN_LIMITS: ReadonlyArray<ThinkingTokenLimit> = [
  ...GEMINI_TOKEN_LIMITS,
  ...QWEN_TOKEN_LIMITS,
  ...CLAUDE_TOKEN_LIMITS,
  ...OTHER_TOKEN_LIMITS,
]

/** Looks up the thinking-token min/max budget for a model id pattern. */
export const findTokenLimit = (modelId: string): { min: number; max: number } | undefined => {
  for (const entry of THINKING_TOKEN_LIMITS) {
    if (new RegExp(entry.pattern, 'i').test(modelId)) {
      return entry
    }
  }
  return undefined
}

/** Interpolates a thinking budget from a token limit, effort ratio, and optional max-tokens cap. */
function resolveThinkingBudget(
  tokenLimit: { min: number; max: number },
  effortRatio: number,
  maxTokens?: number,
): number {
  const budget = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  const capped = maxTokens !== undefined ? Math.min(budget, maxTokens) : budget
  return Math.max(1024, capped)
}

/** Computes a Claude-style thinking budget; undefined when the model has no known limit. */
export function getThinkingBudget(
  maxTokens: number | undefined,
  reasoningEffort: string | undefined,
  modelId: string,
): number | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'off') {
    return undefined
  }
  const tokenLimit = findTokenLimit(modelId)
  if (!tokenLimit) {
    return undefined
  }
  return resolveThinkingBudget(
    tokenLimit,
    EFFORT_RATIO[reasoningEffort as ReasoningEffort] ?? 0.5,
    maxTokens,
  )
}
