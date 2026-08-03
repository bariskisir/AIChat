/** Verifies surrogate-pair-safe slice boundaries never split emoji in half. */

import { describe, expect, it } from 'vitest'
import { clampSurrogateBoundary } from '@shared/utils/text'

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('clampSurrogateBoundary', () => {
  it('steps back when the boundary cuts a surrogate pair', () => {
    expect(clampSurrogateBoundary('ab😀', 3)).toBe(2)
  })

  it('leaves a boundary that falls between whole characters alone', () => {
    expect(clampSurrogateBoundary('ab😀cd', 4)).toBe(4)
    expect(clampSurrogateBoundary('abcd', 2)).toBe(2)
  })

  it('returns the index unchanged at the string edges', () => {
    expect(clampSurrogateBoundary('😀', 0)).toBe(0)
    expect(clampSurrogateBoundary('😀', 2)).toBe(2)
  })

  it('never emits a lone surrogate across a hard-cut slice', () => {
    const text = `${'字'.repeat(9)}😀${'文'.repeat(20)}`
    const cut = clampSurrogateBoundary(text, 10)
    const chunk = text.slice(0, cut)
    expect(LONE_SURROGATE.test(chunk)).toBe(false)
    expect(chunk).toBe('字'.repeat(9))
  })

  it('keeps the emoji whole when appending a truncation marker', () => {
    const text = `${'字'.repeat(48)}😀${'文'.repeat(20)}`
    const marker = '[x]'
    const cut = clampSurrogateBoundary(text, 48 - marker.length)
    expect(LONE_SURROGATE.test(text.slice(0, cut) + marker)).toBe(false)
  })
})
