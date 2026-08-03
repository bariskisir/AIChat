/** Verifies input-history index navigation and key-event guards. */

import { describe, expect, it } from 'vitest'
import {
  getNextInputHistoryIndex,
  shouldHandleInputHistoryNavigation,
} from '@renderer/hooks/inputHistoryNavigation'

describe('getNextInputHistoryIndex', () => {
  it('stays put with no history', () => {
    expect(getNextInputHistoryIndex({ currentIndex: -1, direction: 'up', messagesLength: 0 })).toBe(
      -1,
    )
    expect(
      getNextInputHistoryIndex({ currentIndex: 0, direction: 'down', messagesLength: 0 }),
    ).toBe(0)
  })

  it('moves toward older entries with ArrowUp and stops at the boundary', () => {
    expect(getNextInputHistoryIndex({ currentIndex: -1, direction: 'up', messagesLength: 3 })).toBe(
      0,
    )
    expect(getNextInputHistoryIndex({ currentIndex: 0, direction: 'up', messagesLength: 3 })).toBe(
      1,
    )
    expect(getNextInputHistoryIndex({ currentIndex: 2, direction: 'up', messagesLength: 3 })).toBe(
      2,
    )
  })

  it('moves toward newer entries with ArrowDown and returns to the draft', () => {
    expect(
      getNextInputHistoryIndex({ currentIndex: 2, direction: 'down', messagesLength: 3 }),
    ).toBe(1)
    expect(
      getNextInputHistoryIndex({ currentIndex: 0, direction: 'down', messagesLength: 3 }),
    ).toBe(-1)
    expect(
      getNextInputHistoryIndex({ currentIndex: -1, direction: 'down', messagesLength: 3 }),
    ).toBe(-1)
  })
})

describe('shouldHandleInputHistoryNavigation', () => {
  const base = {
    isAllSelected: false,
    isComposing: false,
    isCursorAtEnd: false,
    key: 'ArrowUp',
    text: '',
  }

  it('handles arrows on an empty composer', () => {
    expect(shouldHandleInputHistoryNavigation(base)).toBe(true)
    expect(shouldHandleInputHistoryNavigation({ ...base, key: 'ArrowDown' })).toBe(true)
  })

  it('handles arrows when the cursor is at the end', () => {
    expect(
      shouldHandleInputHistoryNavigation({ ...base, isCursorAtEnd: true, text: 'hello' }),
    ).toBe(true)
  })

  it('handles arrows when all text is selected', () => {
    expect(
      shouldHandleInputHistoryNavigation({ ...base, isAllSelected: true, text: 'hello' }),
    ).toBe(true)
  })

  it('ignores mid-text arrows', () => {
    expect(shouldHandleInputHistoryNavigation({ ...base, text: 'hello' })).toBe(false)
  })

  it('ignores keys other than arrows', () => {
    expect(shouldHandleInputHistoryNavigation({ ...base, key: 'Enter' })).toBe(false)
  })

  it('ignores arrows during IME composition', () => {
    expect(shouldHandleInputHistoryNavigation({ ...base, isComposing: true })).toBe(false)
  })
})
