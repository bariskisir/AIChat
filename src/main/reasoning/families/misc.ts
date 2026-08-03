/** Remaining reasoning-model detection predicates (Perplexity, Mistral, embeddings, reranks, images). */

import { getLowerBaseModelName } from '../reasoning.shared'
import type { ReasoningModelLike } from '../reasoning.types'

/** Embedding models excluded from reasoning detection. */
const EMBEDDING_REGEX =
  /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

/** Rerank models excluded from reasoning detection. */
const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

/** Dedicated image-generation models excluded from reasoning detection. */
const DEDICATED_IMAGE_MODELS = [
  'dall-e(?:-[\\w-]+)?',
  'gpt-image(?:-[\\w-]+)?',
  'grok-2-image(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'flux(?:-[\\w-]+)?',
  'stable-?diffusion(?:-[\\w-]+)?',
  'stabilityai(?:-[\\w-]+)?',
  'sd-[\\w-]+',
  'sdxl(?:-[\\w-]+)?',
  'cogview(?:-[\\w-]+)?',
  'qwen-image(?:-[\\w-]+)?',
  'janus(?:-[\\w-]+)?',
  'midjourney(?:-[\\w-]+)?',
  'mj-[\\w-]+',
  'z-image(?:-[\\w-]+)?',
  'longcat-image(?:-[\\w-]+)?',
  'hunyuanimage(?:-[\\w-]+)?',
  'seedream(?:-[\\w-]+)?',
  'kandinsky(?:-[\\w-]+)?',
]
const DEDICATED_IMAGE_MODEL_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i')

/** Embedding-model detection. */
export const isEmbeddingModel = (model: ReasoningModelLike): boolean => {
  if (isRerankModel(model)) return false
  return EMBEDDING_REGEX.test(getLowerBaseModelName(model.id))
}

/** Rerank-model detection. */
export const isRerankModel = (model: ReasoningModelLike): boolean =>
  RERANKING_REGEX.test(getLowerBaseModelName(model.id))

/** Dedicated text-to-image model detection. */
export const isTextToImageModel = (model: ReasoningModelLike): boolean =>
  DEDICATED_IMAGE_MODEL_REGEX.test(getLowerBaseModelName(model.id))

/** Perplexity models that accept reasoning_effort. */
export const isSupportedReasoningEffortPerplexityModel = (model: ReasoningModelLike): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('sonar-deep-research')
}

/** Perplexity reasoning models. */
export const isPerplexityReasoningModel = (model?: ReasoningModelLike): boolean => {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    isSupportedReasoningEffortPerplexityModel(model) ||
    (modelId.includes('reasoning') && !modelId.includes('non-reasoning'))
  )
}

/** Mistral Small 2603+ models with adjustable reasoning. */
export function isMistralReasoningModel(model?: ReasoningModelLike): boolean {
  if (!model) return false
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('mistral-small-2603')
}
