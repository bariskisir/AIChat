/** Verifies URL normalization used by every supported OpenAI-compatible provider preset. */

import { describe, expect, it } from 'vitest'
import { normalizeOpenAiBaseUrl } from '@main/providers/openai-compatible/openai-compatible.base-url'

describe('normalizeOpenAiBaseUrl', () => {
  it('adds v1 to provider roots', () => {
    expect(normalizeOpenAiBaseUrl('https://api.openai.com')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAiBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1')
  })

  it('preserves existing compatible paths', () => {
    expect(normalizeOpenAiBaseUrl('https://opencode.ai/zen/v1')).toBe('https://opencode.ai/zen/v1')
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/v1',
    )
  })
})
