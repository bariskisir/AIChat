/** Central family-name matchers shared by every reasoning-model predicate. */

/**
 * One named model family with its stable id-substring convention. Entries are
 * matched against the lowercased base model name (see getLowerBaseModelName).
 */
export type ModelFamily =
  | 'grok43'
  | 'grok4fast'
  | 'grok3mini'
  | 'grok4'
  | 'grokBuild'
  | 'qwen3'
  | 'qwen35to39'
  | 'qwen3Open'
  | 'qwenPlus'
  | 'qwenFlash'
  | 'qwenTurbo'
  | 'qwen3max'
  | 'qwenVl'
  | 'qwq'
  | 'qvq'
  | 'hunyuanA13b'
  | 'hunyuanT1'
  | 'glm5'
  | 'glm45to47'
  | 'glm53'
  | 'glmZ1'
  | 'kimiK25Plus'
  | 'kimiK3Plus'
  | 'kimiK27Code'
  | 'kimiK2Thinking'
  | 'minimaxM1'
  | 'minimaxM2'
  | 'minimaxM3'
  | 'minimaxM3Any'
  | 'mimoV2'
  | 'deepseekV3x'
  | 'deepseekV4Plus'
  | 'deepseekChat'
  | 'step3'
  | 'stepR1Mini'
  | 'ring'
  | 'baichuanM2'
  | 'baichuanM3'
  | 'nemotron'
  | 'museGlimmer'
  | 'solarPro'
  | 'gemma4'
  | 'gemini3'
  | 'geminiFlashLatest'
  | 'geminiProLatest'
  | 'geminiFlashLiteLatest'

/** Family-name to model-id pattern lookup table (lowercase base names only). */
export const FAMILY_PATTERNS: Readonly<Record<ModelFamily, RegExp>> = Object.freeze({
  grok43: /grok-4\.3/,
  grok4fast: /grok-4-fast/,
  grok3mini: /grok-3-mini/,
  grok4: /grok-4/,
  grokBuild: /grok-build/,
  qwen3: /^qwen3/,
  qwen35to39: /^qwen3\.[5-9]/,
  qwen3Open: /^qwen3-\d/,
  qwenPlus: /^qwen(?:3\.[5-9])?-plus(?:-|$)/,
  qwenFlash: /^qwen(?:3\.[5-9])?-flash(?:-|$)/,
  qwenTurbo: /^qwen(?:3\.[5-9])?-turbo(?:-|$)/,
  qwen3max: /^(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)/,
  qwenVl: /qwen3-vl/,
  qwq: /qwq/,
  qvq: /qvq/,
  hunyuanA13b: /hunyuan-a13b/,
  hunyuanT1: /hunyuan-t1/,
  glm5: /glm-?5/,
  glm45to47: /glm-4\.[567]/,
  glmZ1: /glm-z1/,
  kimiK25Plus: /kimi-k2\.[5-9]\d*/,
  kimiK3Plus: /(?:kimi-k[3-9]\d*|^k[3-9](?:[-_.]|$))/,
  kimiK27Code: /^kimi-k2\.7-code(?:-[\w-]+)?$/,

  kimiK2Thinking: /^kimi-k2-thinking(?:-turbo)?$/,
  minimaxM1: /minimax-m1/,
  minimaxM2: /minimax-m2/,
  minimaxM3: /^minimax-m3(?:\.\d+)?(?:-[\w-]+)?$/,
  minimaxM3Any: /minimax-m3/,
  mimoV2: /^(?:mimo-v2-flash|mimo-v2-pro|mimo-v2-omni|mimo-v2\.5|mimo-v2\.5-pro)$/,
  deepseekV3x: /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/,
  deepseekV4Plus: /(\w+-)?deepseek-v([4-9]|\d{2,})([.-]\w+)*$/,
  deepseekChat: /deepseek-chat/,
  step3: /step-3/,
  stepR1Mini: /step-r1-v-mini/,
  ring: /ring-(?:1t|mini|flash)/,
  baichuanM2: /^baichuan-m2$/,
  baichuanM3: /^baichuan-m3$/,
  nemotron: /(?:llama-3-1-)?nemotron-(?:\d+(?:-\d+)*-)?(?:nano|super|ultra|lightning)/,
  museGlimmer: /^muse-glimmer/,
  solarPro: /^solar-pro-?[2-9]/,
  glm53: /glm-5[.-]3(?:-|$)/,
  gemma4: /gemma4|gemma-4/,
  gemini3: /gemini-3/,
  geminiFlashLatest: /^gemini-flash-latest$/,
  geminiProLatest: /^gemini-pro-latest$/,
  geminiFlashLiteLatest: /^gemini-flash-lite-latest$/,
})

/** Tests one lowercase model id against one named family pattern. */
export const belongsToFamily = (modelId: string, family: ModelFamily): boolean =>
  FAMILY_PATTERNS[family].test(modelId)

/** Tests one lowercase model id against every listed family pattern. */
export const belongsToAnyFamily = (modelId: string, families: readonly ModelFamily[]): boolean =>
  families.some((family) => belongsToFamily(modelId, family))
