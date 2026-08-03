/** Pure helpers for deterministic and Quick-Model chat titles. */

/** Caps the visible length of every generated chat title. */
export const TITLE_MAX_LENGTH = 40

/** Teaches the Quick Model to return only a short, plain chat title. */
export const TITLE_SYSTEM_PROMPT =
  'Generate a concise chat title of at most 40 characters from the user request. Return only the title text.'

/** Produces the deterministic title used from the first user message. */
export const fallbackTitle = (content: string): string =>
  content.trim().replace(/\s+/g, ' ').slice(0, 48) || 'New Chat'

/** Normalizes Quick-Model output into one compact single-line title. */
export const sanitizeTitle = (content: string): string =>
  content
    .replace(/["'\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX_LENGTH)
