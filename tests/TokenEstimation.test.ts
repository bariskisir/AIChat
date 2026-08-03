/** Verifies immediate local token estimates for empty, Latin, and CJK user text. */

import { describe, expect, it } from 'vitest'
import { estimateTextTokens } from '@shared/utils/token.estimation'

describe('estimateTextTokens', () => {
  it('returns zero for empty text', () => {
    expect(estimateTextTokens('   ')).toBe(0)
  })

  it('estimates Latin text without returning zero', () => {
    expect(estimateTextTokens('hello world')).toBeGreaterThan(0)
  })

  it('counts CJK characters more densely than Latin characters', () => {
    expect(estimateTextTokens('你好世界')).toBe(4)
  })
})
