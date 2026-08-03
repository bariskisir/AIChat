/** Pure helpers for deterministic and Quick-Model chat titles. */

import { clampSurrogateBoundary } from '@shared/index'

/** Caps the visible length of every generated chat title. */
export const TITLE_MAX_LENGTH = 40

/** Teaches the Quick Model to return only a short, plain chat title. */
export const TITLE_SYSTEM_PROMPT =
  'Generate a concise chat title of at most 40 characters from the user request. Return only the title text.'

/** Produces the deterministic title used from the first user message. */
export const fallbackTitle = (content: string): string => {
  const normalized = content.trim().replace(/\s+/g, ' ')
  return normalized.slice(0, clampSurrogateBoundary(normalized, 48)) || 'New Chat'
}

/** Normalizes Quick-Model output into one compact single-line title. */
export const sanitizeTitle = (content: string): string => {
  const normalized = content
    .replace(/["'\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, clampSurrogateBoundary(normalized, TITLE_MAX_LENGTH))
}
