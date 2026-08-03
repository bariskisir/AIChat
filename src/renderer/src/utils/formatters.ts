/**
 * Provides consistent formatting helpers for conversation metadata.
 */

import type { TimeFormat, Conversation, ConversationSummary } from '@shared/index'

/** Formats a stored ISO date with the preferred 12- or 24-hour clock. */
export const formatDate = (isoDate: string, timeFormat: TimeFormat): string => {
  const date = new Date(isoDate)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = String(date.getFullYear()).slice(2)
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const localHours = date.getHours()

  if (timeFormat === '12-hour') {
    const hours = (localHours % 12 || 12).toString().padStart(2, '0')
    const period = localHours >= 12 ? 'PM' : 'AM'
    return `${day}.${month}.${year} ${hours}:${minutes} ${period}`
  }

  return `${day}.${month}.${year} ${localHours.toString().padStart(2, '0')}:${minutes}`
}

/** Formats a timestamp as local day, month, and 24-hour time. */
export const formatMonthDayTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

/** Converts a complete conversation into a compact history summary. */
export const toConversationSummary = (conversation: Conversation): ConversationSummary => ({
  id: conversation.id,
  title: conversation.title,
  isDefaultTitle: conversation.isDefaultTitle,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
})
