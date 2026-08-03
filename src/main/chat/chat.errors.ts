/** Shared provider-response error and token/reasoning parsing helpers. */

import type { TokenUsage } from '@shared/index'
import { MAX_CHAT_ERROR_LENGTH } from '@shared/index'

/** Bounds one provider response body while clearly marking truncated diagnostics. */
export const boundProviderErrorText = (text: string): string => {
  const normalized = text.trim()
  if (normalized.length <= MAX_CHAT_ERROR_LENGTH) return normalized
  const marker = '\n[Provider response truncated.]'
  return `${normalized.slice(0, MAX_CHAT_ERROR_LENGTH - marker.length)}${marker}`
}

/** Builds a chat-safe HTTP error containing the provider's actual response body. */
export const createProviderError = async (response: Response): Promise<Error> => {
  const responseBody = await response.text().catch(() => '')
  const status = response.statusText.trim()
    ? `${response.status} ${response.statusText.trim()}`
    : String(response.status)
  const summary = `Provider returned ${status}.`
  return new Error(boundProviderErrorText(responseBody ? `${summary}\n${responseBody}` : summary))
}

/** Reads the first finite non-negative token counter found under compatible field names. */
export const readTokenCount = (
  record: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  }
  return null
}

/** Normalizes OpenAI-compatible and Ollama-compatible streamed token usage payloads. */
export const parseTokenUsage = (payload: Record<string, unknown>): TokenUsage | null => {
  const nested =
    payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
      ? (payload.usage as Record<string, unknown>)
      : payload
  const promptTokens =
    readTokenCount(nested, 'prompt_tokens', 'promptTokens', 'input_tokens', 'prompt_eval_count') ??
    0
  const completionTokens =
    readTokenCount(
      nested,
      'completion_tokens',
      'completionTokens',
      'output_tokens',
      'eval_count',
    ) ?? 0
  const reportedTotal = readTokenCount(nested, 'total_tokens', 'totalTokens')
  if (reportedTotal === null && promptTokens === 0 && completionTokens === 0) return null
  return {
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal ?? promptTokens + completionTokens,
  }
}

/** Reads reasoning text from common OpenAI, DeepSeek, OpenRouter, Kimi, and Anthropic fields. */
export const readReasoningDelta = (record: Record<string, unknown>): string => {
  if (typeof record.reasoning_content === 'string') return record.reasoning_content
  if (typeof record.reasoningContent === 'string') return record.reasoningContent
  if (typeof record.reasoning === 'string') return record.reasoning
  if (typeof record.thinking_content === 'string') return record.thinking_content
  if (typeof record.thinking === 'string') return record.thinking
  if (!Array.isArray(record.reasoning_details)) return ''
  return record.reasoning_details
    .flatMap((detail) => {
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return []
      const value = detail as Record<string, unknown>
      if (typeof value.text === 'string') return [value.text]
      if (typeof value.summary === 'string') return [value.summary]
      return []
    })
    .join('')
}
