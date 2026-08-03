/**
 * Provides a fast local token estimate for user-authored text without loading a model tokenizer.
 */

/**
 * Estimates mixed CJK and non-CJK text tokens for immediate message metadata display.
 * Each CJK character counts as one token and every four non-CJK characters as one token.
 */
export const estimateTextTokens = (text: string): number => {
  const normalized = text.trim()
  if (!normalized) return 0
  const cjk = normalized.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu) ?? []
  const nonCjkLength = normalized
    .replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu, '')
    .replace(/\s+/gu, ' ').length
  return Math.max(1, cjk.length + Math.ceil(nonCjkLength / 4))
}
