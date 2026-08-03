/** Claude-family reasoning-model detection predicates. */

import { getLowerBaseModelName } from '../reasoning.shared'
import type { ReasoningModelLike } from '../reasoning.types'

/** Claude 4.5 reasoning families that expose thinking control. */
const CLAUDE_45_FAMILIES = ['sonnet', 'opus', 'haiku'] as const

/** Matches a claude-<family>-4.x/4-x id with an optional dash suffix. */
const CLAUDE_45_VERSION_PATTERN = new RegExp(
  `^claude-(?:${CLAUDE_45_FAMILIES.join('|')})-4[.-]5(?:-[\\w-]+)*$`,
  'i',
)

/** Claude 4.6 adaptive-thinking families. */
const CLAUDE_46_FAMILIES = ['opus', 'sonnet'] as const

/** Claude reasoning-model detection (3.7, 4.x, Fable, and adaptive-thinking Opus 4.7+/5+). */
export const isClaudeReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    modelId.includes('claude-3-7-sonnet') ||
    modelId.includes('claude-3.7-sonnet') ||
    modelId.includes('claude-sonnet-4') ||
    modelId.includes('claude-opus-4') ||
    modelId.includes('claude-haiku-4') ||
    modelId.includes('claude-fable') ||
    isClaudeOpus47OrNewerModel(model)
  )
}

/** True for Claude models that expose thinking-token control. */
export const isSupportedThinkingTokenClaudeModel = isClaudeReasoningModel

/** Claude 4.5 reasoning models (temperature/top-p mutual exclusion applies elsewhere). */
export const isClaude45ReasoningModel = (model: ReasoningModelLike): boolean =>
  CLAUDE_45_VERSION_PATTERN.test(getLowerBaseModelName(model.id, '/'))

/** Claude 4.6 series models (adaptive thinking with effort parameters). */
export const isClaude46SeriesModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  const match = modelId.match(/^claude-(opus|sonnet)-(\d+)[.-](\d+)(?:[@\-:][\w\-:]+)?$/i)
  if (!match) return false
  const family = match[1]?.toLowerCase() ?? ''
  if (!(CLAUDE_46_FAMILIES as readonly string[]).includes(family)) return false
  return Number(match[2]) === 4 && Number(match[3]) === 6
}

/** True when a Claude model uses adaptive thinking rather than budget-token thinking. */
export const isSupportAdaptiveThinkingClaudeModel = (
  model: ReasoningModelLike | undefined | null,
): boolean => isClaudeOpus47OrNewerModel(model)

/** Opus 4.7+/Fable 5+ models using adaptive thinking instead of token budgets. */
const isClaudeOpus47OrNewerModel = (model: ReasoningModelLike | undefined | null): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  const match = modelId.match(
    /^(?:anthropic\.)?claude-(opus|fable)-(\d+)(?:[.-](\d{1,2}))?(?:[@\-:][\w\-:]+)?$/i,
  )
  if (!match) return false
  const family = match[1]?.toLowerCase() ?? ''
  const major = Number(match[2])
  const minor = match[3] ? Number(match[3]) : 0
  if (family === 'fable') return major >= 5
  return major > 4 || (major === 4 && minor >= 7)
}
