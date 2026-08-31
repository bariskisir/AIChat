/** Chinese-provider reasoning-model detection predicates (Qwen, Doubao, Hunyuan, Zhipu, MiMo, Kimi, MiniMax, DeepSeek). */

import { belongsToAnyFamily, belongsToFamily, FAMILY_PATTERNS } from '../familyPatterns'
import { getLowerBaseModelName, withModelIdAndNameAsId } from '../reasoning.shared'
import type { ReasoningModelLike } from '../reasoning.types'

/** Doubao 1.5 thinking-vision-pro identifier. */
const DOUBAO_VISION_PRO_ID = '1[.-]5-thinking-vision-pro'

/** Doubao 1.5 thinking-pro-m identifier. */
const DOUBAO_THINKING_PRO_M_ID = '1[.-]5-thinking-pro-m'

/** Doubao seed 1.6/1.8 identifier (except explicit thinking suffixes). */
const DOUBAO_SEED_16_18_ID = 'seed-1[.-][68](?:-flash)?(?!-(?:thinking)(?:-|$))'

/** Doubao seed-code identifier. */
const DOUBAO_SEED_CODE_ID = 'seed-code(?:-preview)?(?:-\\d+)?'

/** Doubao seed 2.0 identifier. */
const DOUBAO_SEED_20_ID = 'seed-2[.-]0(?:-[\\w-]+)?'

/** Doubao models with thinking-token control. */
export const DOUBAO_THINKING_MODEL_REGEX = new RegExp(
  `doubao-(?:${[
    DOUBAO_VISION_PRO_ID,
    DOUBAO_THINKING_PRO_M_ID,
    DOUBAO_SEED_16_18_ID,
    DOUBAO_SEED_CODE_ID,
    DOUBAO_SEED_20_ID,
  ].join('|')})(?:-[\\w-]+)*`,
  'i',
)

/** Doubao 1.5 thinking-pro-m identifier (still supports auto mode). */
const DOUBAO_AUTO_THINKING_PRO_M_ID = '1-5-thinking-pro-m'

/** Doubao seed 1.6 identifier (still supports auto mode). */
const DOUBAO_AUTO_SEED_16_ID = 'seed-1[.-]6'

/** Doubao models that still support the auto thinking mode. */
export const DOUBAO_THINKING_AUTO_MODEL_REGEX = new RegExp(
  `doubao-(?:${DOUBAO_AUTO_THINKING_PRO_M_ID}|${DOUBAO_AUTO_SEED_16_ID})(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\\d+)?$`,
  'i',
)

/** Qwen reasoning models (Qwen3 thinking, Qwen3.5+, qwq/qvq). */
export function isQwenReasoningModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  if (belongsToFamily(modelId, 'qwen3') && modelId.includes('thinking')) return true
  if (isSupportedThinkingTokenQwenModel(model)) return true
  if (belongsToAnyFamily(modelId, ['qwq', 'qvq'])) return true
  return false
}

/** Qwen3 / Qwen3.5+ models that accept thinking control. */
export function isSupportedThinkingTokenQwenModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  if (/(?:coder|asr|tts|reranker|embedding|instruct|thinking)/.test(modelId)) return false
  if (belongsToFamily(modelId, 'qwen35to39')) return true
  return belongsToAnyFamily(modelId, [
    'qwen3max',
    'qwenPlus',
    'qwenFlash',
    'qwenTurbo',
    'qwen3Open',
  ])
}

/** Qwen always-think models (no way to disable thinking). */
export function isQwenAlwaysThinkModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    (belongsToFamily(modelId, 'qwen3') && modelId.includes('thinking')) ||
    (belongsToFamily(modelId, 'qwenVl') && modelId.includes('thinking'))
  )
}

/** Qwen 3.5~3.9 series models. */
export function isQwen35to39Model(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToFamily(modelId, 'qwen35to39')
}

/** Doubao models that still support the auto thinking mode. */
export function isDoubaoThinkingAutoModel(model: ReasoningModelLike): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return (
    DOUBAO_THINKING_AUTO_MODEL_REGEX.test(modelId) ||
    DOUBAO_THINKING_AUTO_MODEL_REGEX.test(model.name ?? '')
  )
}

/** Doubao seed 1.6 with the 251015 release marker. */
const DOUBAO_251015_RELEASE_ID = 'doubao-seed-1-6-(?:lite-)?251015'

/** Doubao seed 2.0 series identifier. */
const DOUBAO_SEED_20_SERIES_ID = 'doubao-seed-2[.-]0'

/** Doubao seed models released after the 251015 auto-thinking removal. */
export function isDoubaoSeedAfter251015(model: ReasoningModelLike): boolean {
  const pattern = new RegExp(`${DOUBAO_251015_RELEASE_ID}|${DOUBAO_SEED_20_SERIES_ID}`, 'i')
  return pattern.test(model.id) || pattern.test(model.name ?? '')
}

/** Doubao seed 1.8 series identifier. */
const DOUBAO_SEED_18_SERIES_ID = 'doubao-seed-1[.-]8(?:-[\\w-]+)?'

/** Doubao seed 1.8 models. */
export function isDoubaoSeed18Model(model: ReasoningModelLike): boolean {
  const pattern = new RegExp(DOUBAO_SEED_18_SERIES_ID, 'i')
  return pattern.test(model.id) || pattern.test(model.name ?? '')
}

/** Doubao models with thinking-token control. */
export function isSupportedThinkingTokenDoubaoModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    DOUBAO_THINKING_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_MODEL_REGEX.test(model.name ?? '')
  )
}

/** Hunyuan models with thinking-token control. */
export const isSupportedThinkingTokenHunyuanModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToFamily(modelId, 'hunyuanA13b')
}

/** Hunyuan reasoning models. */
export const isHunyuanReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedThinkingTokenHunyuanModel(model) || belongsToFamily(modelId, 'hunyuanT1')
}

/** Zhipu (GLM) models with thinking-token control (GLM-4.5+, GLM-5+). */
export const isSupportedThinkingTokenZhipuModel = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToAnyFamily(modelId, ['glm5', 'glm45to47', 'glm53'])
}

/** GLM-5.3-Flash: dedicated effort low/high/max without toggle. */
export const isGlm53Model = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToFamily(modelId, 'glm53')
}

/** Zhipu reasoning models. */
export const isZhipuReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedThinkingTokenZhipuModel(model) || belongsToFamily(modelId, 'glmZ1')
}

/** MiMo models with thinking-token control (exact id match). */
export const isSupportedThinkingTokenMiMoModel = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToFamily(modelId, 'mimoV2')
}

/** MiMo reasoning models. */
export const isMiMoReasoningModel = isSupportedThinkingTokenMiMoModel

/** Kimi K2.5+ / K3+ models (thinking-token control). */
export const isKimi25OrNewerModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return belongsToAnyFamily(modelId, ['kimiK25Plus', 'kimiK3Plus'])
}

/** Kimi models that accept thinking-token control. */
const isSupportedThinkingTokenKimiModelId = (model: ReasoningModelLike): boolean =>
  isKimi25OrNewerModel(model)

/** Kimi models that accept thinking-token control (id or display name). */
export const isSupportedThinkingTokenKimiModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const [idResult, nameResult] = withModelIdAndNameAsId(model, isSupportedThinkingTokenKimiModelId)
  return idResult || nameResult
}

/** Kimi K2.7 Code: always-think model that only accepts { type: 'enabled' }. */
const isKimiK27CodeModelId = (model: ReasoningModelLike): boolean =>
  belongsToFamily(getLowerBaseModelName(model.id, '/'), 'kimiK27Code')

/** Kimi K2.7 Code detection (id or display name). */
export const isKimiK27CodeModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const [idResult, nameResult] = withModelIdAndNameAsId(model, isKimiK27CodeModelId)
  return idResult || nameResult
}

/** Kimi K2.5+/K3+ series alternatives joined from the family table. */
const kimiSeriesAlternatives = (['kimiK25Plus', 'kimiK3Plus'] as const)
  .map((family) => `(?:${FAMILY_PATTERNS[family].source})`)
  .join('|')

/** Kimi K2.5+ / K3+ reasoning ids, optionally followed by a dash/dot suffix chain. */
const KIMI_SERIES_REASONING_PATTERN = new RegExp(
  `^kimi-k(?:${kimiSeriesAlternatives})(?:[.\\-]\\w+)*$`,
  'i',
)

/** Kimi reasoning models (K2 Thinking, K2.5+, K3+). */
const isKimiReasoningModelId = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  if (belongsToFamily(modelId, 'kimiK2Thinking')) return true
  return KIMI_SERIES_REASONING_PATTERN.test(modelId)
}

/** Kimi reasoning-model detection (id or display name). */
export function isKimiReasoningModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const [idResult, nameResult] = withModelIdAndNameAsId(model, isKimiReasoningModelId)
  return idResult || nameResult
}

/** MiniMax reasoning models (M1, M2.x, M3). */
export const isMiniMaxReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToAnyFamily(modelId, ['minimaxM1', 'minimaxM2', 'minimaxM3Any'])
}

/** MiniMax-M3: only accepts thinking.type 'adaptive' | 'disabled' on compatible endpoints. */
export const isMiniMaxM3Model = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToFamily(modelId, 'minimaxM3')
}

/** DeepSeek V4+ models (default to thinking enabled; effort 'high' | 'max'). */
export const isDeepSeekV4PlusModel = (model: ReasoningModelLike): boolean => {
  const [idResult, nameResult] = withModelIdAndNameAsId(model, (m) => {
    const modelId = getLowerBaseModelName(m.id).split(':', 1)[0] ?? ''
    return belongsToFamily(modelId, 'deepseekV4Plus')
  })
  return idResult || nameResult
}

/** DeepSeek hybrid-inference ids (v3.1+ and v4+). */
const isDeepSeekHybridId = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return belongsToFamily(modelId, 'deepseekV3x') || belongsToFamily(modelId, 'deepseekChat')
}

/** DeepSeek hybrid-inference models (v3.1+ and v4+). */
export const isDeepSeekHybridInferenceModel = (model: ReasoningModelLike): boolean => {
  const [idResult, nameResult] = withModelIdAndNameAsId(model, isDeepSeekHybridId)
  return idResult || nameResult || isDeepSeekV4PlusModel(model)
}

/** DeepSeek models with thinking-token control. */
export const isSupportedThinkingTokenDeepSeekModel = isDeepSeekHybridInferenceModel

/** Step reasoning models. */
export const isStepReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToAnyFamily(modelId, ['step3', 'stepR1Mini'])
}

/** Ling (Ring) reasoning models. */
export const isLingReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToFamily(modelId, 'ring')
}

/** Baichuan reasoning models (M2, M3). */
export const isBaichuanReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return belongsToAnyFamily(modelId, ['baichuanM2', 'baichuanM3'])
}
