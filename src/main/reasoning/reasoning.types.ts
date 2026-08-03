/** Shared reasoning-model identity and provider identity shapes. */

/** A model identity with an optional display name for id/name fallback checks. */
export interface ReasoningModelLike {
  id: string
  name?: string | undefined
  supportsThinking?: boolean | undefined
}

/** Provider identity used to select provider-specific parameter shapes. */
export interface ReasoningProviderLike {
  id?: string | undefined
  name?: string | undefined
  baseUrl?: string | undefined
}

/** The subset of provider identities with provider-specific reasoning shapes. */
export type ReasoningProviderKind =
  | 'openrouter'
  | 'nvidia'
  | 'silicon'
  | 'dashscope'
  | 'together'
  | 'poe'
  | 'cerebras'
  | 'groq'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'minimax'
  | 'hunyuan'
  | 'doubao'
  | 'baichuan'
  | 'stepfun'
  | 'mistral'
  | 'perplexity'
  | 'xai'
  | 'gemini'
  | 'openai'
  | 'new-api'
  | 'ollama'
  | 'lmstudio'
  | 'generic'
