/** Shared helpers and constants used across the reasoning layer. */

import type { ReasoningEffort } from '@shared/index'
import type {
  ReasoningModelLike,
  ReasoningProviderKind,
  ReasoningProviderLike,
} from './reasoning.types'

/** Ordered effort-to-budget ratio pairs, in this app's effort vocabulary (off = API none). */
const EFFORT_RATIO_TABLE: ReadonlyArray<readonly [ReasoningEffort, number]> = [
  ['default', 0],
  ['off', 0.01],
  ['minimal', 0.05],
  ['low', 0.05],
  ['medium', 0.5],
  ['high', 0.8],
  ['xhigh', 0.9],
  ['auto', 2],
]

/** Effort-to-budget ratios, keyed by this app's effort vocabulary (off = API none). */
export const EFFORT_RATIO: Readonly<Record<ReasoningEffort, number>> = Object.freeze(
  Object.fromEntries(EFFORT_RATIO_TABLE) as Record<ReasoningEffort, number>,
)

/** Looks up the budget ratio for one reasoning effort, defaulting to medium. */
export const effortRatioFor = (effort: string | undefined): number =>
  EFFORT_RATIO[(effort ?? 'medium') as ReasoningEffort] ?? 0.5

/** Default max-tokens fallback used when capping Claude thinking budgets. */
export const DEFAULT_MAX_TOKENS = 4096

/** Fireworks catalogue prefix whose version segments use a compact '3p2' notation. */
const FIREWORKS_MODELS_PREFIX = 'accounts/fireworks/models/'

/** Expands Fireworks compact versions (3p2 -> 3.2) only for their catalogue prefix. */
const expandFireworksVersion = (id: string): string =>
  id.toLowerCase().startsWith(FIREWORKS_MODELS_PREFIX) ? id.replace(/(\d)p(?=\d)/g, '$1.') : id

/** Removes one trailing provider-only suffix such as :free, (free), or :cloud. */
const stripTrailingProviderSuffix = (value: string): string =>
  value.replace(/(?::free|\(free\)|:cloud)$/, '')

/** Lowercases a model id, keeps the last path segment, and strips provider suffixes. */
export const getLowerBaseModelName = (id: string, delimiter: string = '/'): string =>
  stripTrailingProviderSuffix(
    expandFireworksVersion(id).split(delimiter).at(-1)?.toLowerCase() ?? '',
  )

/** Runs a predicate against both the model id and its display name. */
export const withModelIdAndNameAsId = <T>(
  model: ReasoningModelLike,
  fn: (model: ReasoningModelLike) => T,
): [T, T] => [fn(model), fn({ ...model, id: model.name ?? '' })]

/** Ordered provider-kind detection rules applied to the id/name/host haystack. */
const PROVIDER_KIND_RULES: ReadonlyArray<{
  pattern: RegExp
  kind: ReasoningProviderKind
  port?: RegExp
}> = [
  { pattern: /openrouter/, kind: 'openrouter' },
  { pattern: /nvidia/, kind: 'nvidia' },
  { pattern: /siliconflow/, kind: 'silicon' },
  { pattern: /dashscope/, kind: 'dashscope' },
  { pattern: /together/, kind: 'together' },
  { pattern: /poe\.com/, kind: 'poe' },
  { pattern: /cerebras/, kind: 'cerebras' },
  { pattern: /groq/, kind: 'groq' },
  { pattern: /deepseek/, kind: 'deepseek' },
  { pattern: /moonshot|kimi\.com/, kind: 'moonshot' },
  { pattern: /bigmodel|zhipu|z\.ai/, kind: 'zhipu' },
  { pattern: /minimaxi|minimax/, kind: 'minimax' },
  { pattern: /hunyuan|tencent/, kind: 'hunyuan' },
  { pattern: /volces|doubao/, kind: 'doubao' },
  { pattern: /baichuan/, kind: 'baichuan' },
  { pattern: /stepfun/, kind: 'stepfun' },
  { pattern: /mistral/, kind: 'mistral' },
  { pattern: /perplexity/, kind: 'perplexity' },
  { pattern: /x\.ai|api\.grok/, kind: 'xai' },
  { pattern: /generativelanguage|gemini/, kind: 'gemini' },
  { pattern: /new-api|newapi/, kind: 'new-api' },
  { pattern: /ollama/, kind: 'ollama', port: /:11434/ },
  { pattern: /lm[- ]?studio/, kind: 'lmstudio', port: /:1234/ },
  { pattern: /openai/, kind: 'openai' },
]

/** Detects a provider kind from id, display name, and base URL hostname. */
export const detectProviderKind = (provider?: ReasoningProviderLike): ReasoningProviderKind => {
  const id = provider?.id?.toLowerCase() ?? ''
  const name = provider?.name?.toLowerCase() ?? ''
  let host = ''
  try {
    host = provider?.baseUrl ? new URL(provider.baseUrl).hostname.toLowerCase() : ''
  } catch {
    host = ''
  }
  const haystack = `${id} ${name} ${host}`
  for (const { pattern, kind, port } of PROVIDER_KIND_RULES) {
    if (pattern.test(haystack) || port?.test(provider?.baseUrl ?? '')) return kind
  }
  return 'generic'
}

/** Providers that cannot control Qwen-style thinking with enable_thinking. */
const NOT_SUPPORT_ENABLE_THINKING_KINDS: ReadonlySet<ReasoningProviderKind> = new Set([
  'ollama',
  'lmstudio',
  'nvidia',
  'generic',
])

/** True when a provider understands the enable_thinking request parameter. */
export const isSupportEnableThinkingProvider = (provider?: ReasoningProviderLike): boolean =>
  !NOT_SUPPORT_ENABLE_THINKING_KINDS.has(detectProviderKind(provider))

/** O-series model ids (o1, o3, o4 and their suffixes). */
const O_SERIES_PATTERN = 'o\\d+(?:-[\\w-]+)?'

/** Model names carrying an explicit reasoning keyword. */
const REASONING_KEYWORD_PATTERN = '.*\\b(?:reasoning|reasoner|thinking|think)\\b.*'

/** Model names carrying a revision marker like -r4. */
const REVISION_MARKER_PATTERN = '.*-[rR]\\d+.*'

/** Qwen-Think variants (qwq and friends). */
const QWQ_PATTERN = '.*\\bqwq(?:-[\\w-]+)?\\b.*'

/** Hunyuan T1 reasoning models. */
const HUNYUAN_T1_PATTERN = '.*\\bhunyuan-t1(?:-[\\w-]+)?\\b.*'

/** GLM zero-preview reasoning models. */
const GLM_ZERO_PREVIEW_PATTERN = '.*\\bglm-zero-preview\\b.*'

/** Grok reasoning tiers. */
const GROK_PATTERN = '.*\\bgrok-(?:3-mini|4|4-fast|build)(?:-[\\w-]+)?\\b.*'

/** Guards against explicitly non-reasoning model variants. */
const NON_REASONING_GUARD_PATTERN = '(?!.*-non-reasoning\\b)'

/** Reasoning models matched by naming conventions. */
export const REASONING_REGEX = new RegExp(
  `^${NON_REASONING_GUARD_PATTERN}(?:${O_SERIES_PATTERN}|${REASONING_KEYWORD_PATTERN}|${REVISION_MARKER_PATTERN}|${QWQ_PATTERN}|${HUNYUAN_T1_PATTERN}|${GLM_ZERO_PREVIEW_PATTERN}|${GROK_PATTERN})$`,
  'i',
)
