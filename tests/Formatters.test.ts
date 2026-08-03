/**
 * Verifies conversation metadata formatting helpers.
 */

import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatMonthDayTime,
  toConversationSummary,
} from '../src/renderer/src/utils/formatters'
import type { Conversation } from '@shared/index'

describe('formatDate', () => {
  it('formats 24-hour dates', () => {
    const result = formatDate('2026-01-02T13:05:00.000Z', '24-hour')
    expect(result).toMatch(/^02\.01\.26 \d{2}:\d{2}$/)
  })

  it('formats 12-hour dates with a period', () => {
    const result = formatDate('2026-01-02T13:05:00.000Z', '12-hour')
    expect(result).toMatch(/^02\.01\.26 \d{2}:\d{2} (AM|PM)$/)
  })
})

describe('formatMonthDayTime', () => {
  it('formats local reset timestamps without the year', () => {
    expect(formatMonthDayTime(new Date(2026, 11, 31, 23, 59).getTime())).toBe('31.12 23:59')
  })
})

describe('toConversationSummary', () => {
  it('copies generic conversation metadata', () => {
    const conversation: Conversation = {
      revision: 1,
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Conversation',
      isDefaultTitle: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [],
      selectedModel: null,
      searchMode: 'off',
      lastSearchEngine: 'google',
      reasoningEffort: 'off',
    }
    expect(toConversationSummary(conversation)).toEqual({
      id: conversation.id,
      title: conversation.title,
      isDefaultTitle: conversation.isDefaultTitle,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    })
  })
})
