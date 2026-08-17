/**
 * Verifies the thresholds and clamping that keep oversized pastes out of the
 * composer value and oversized message bodies out of the Markdown renderer.
 */

import { describe, expect, it } from 'vitest'
import {
  clampText,
  COLLAPSE_MESSAGE_THRESHOLD,
  COLLAPSED_PREVIEW_CHARACTERS,
  formatCharacterCount,
  isOverlongMessage,
  MAX_PASTED_TEXT_CHARACTERS,
  PASTE_AS_ATTACHMENT_THRESHOLD,
  shouldAttachPastedText,
} from '../src/renderer/src/utils/largeText'

describe('shouldAttachPastedText', () => {
  it('leaves an ordinary paste inline', () => {
    expect(shouldAttachPastedText('a'.repeat(PASTE_AS_ATTACHMENT_THRESHOLD))).toBe(false)
  })

  it('diverts a paste past the threshold to an attachment', () => {
    expect(shouldAttachPastedText('a'.repeat(PASTE_AS_ATTACHMENT_THRESHOLD + 1))).toBe(true)
  })

  it('treats an empty paste as inline', () => {
    expect(shouldAttachPastedText('')).toBe(false)
  })
})

describe('isOverlongMessage', () => {
  it('renders a message at the threshold normally', () => {
    expect(isOverlongMessage('a'.repeat(COLLAPSE_MESSAGE_THRESHOLD))).toBe(false)
  })

  it('collapses a message past the threshold', () => {
    expect(isOverlongMessage('a'.repeat(COLLAPSE_MESSAGE_THRESHOLD + 1))).toBe(true)
  })
})

describe('clampText', () => {
  it('returns short text unchanged', () => {
    expect(clampText('hello', 10)).toBe('hello')
  })

  it('returns text of exactly the limit unchanged', () => {
    expect(clampText('hello', 5)).toBe('hello')
  })

  it('cuts text longer than the limit', () => {
    expect(clampText('hello world', 5)).toBe('hello')
  })

  it('never splits a surrogate pair', () => {
    // '😀' is two UTF-16 units, so a limit of 3 would land inside the pair.
    const clamped = clampText(`ab😀cd`, 3)
    expect(clamped).toBe('ab')
    expect(clamped.split('').some((unit) => unit.charCodeAt(0) >= 0xd800)).toBe(false)
  })

  it('keeps a surrogate pair whole when the boundary clears it', () => {
    expect(clampText(`ab😀cd`, 4)).toBe('ab😀')
  })
})

describe('thresholds', () => {
  it('keeps the collapsed preview smaller than the collapse threshold', () => {
    expect(COLLAPSED_PREVIEW_CHARACTERS).toBeLessThan(COLLAPSE_MESSAGE_THRESHOLD)
  })

  it('bounds a pasted attachment above the inline paste threshold', () => {
    expect(MAX_PASTED_TEXT_CHARACTERS).toBeGreaterThan(PASTE_AS_ATTACHMENT_THRESHOLD)
  })
})

describe('formatCharacterCount', () => {
  it('groups digits for readability', () => {
    expect(formatCharacterCount(1234)).toBe((1234).toLocaleString())
  })
})
