/**
 * Thresholds and pure helpers that keep very large text out of the composer's
 * value and out of the Markdown renderer. Oversized pastes travel as text
 * attachments instead, and oversized message bodies render behind an explicit
 * expand so a single message cannot stall or distort the chat layout.
 */

import { clampSurrogateBoundary } from '@shared/index'

/** Longest paste still inserted straight into the composer as inline text. */
export const PASTE_AS_ATTACHMENT_THRESHOLD = 10_000

/**
 * Longest text one pasted attachment carries. Matches the attachment IPC bound,
 * which in turn matches how much extracted text ever reaches a provider, so the
 * character count shown in the UI is exactly what the model receives.
 */
export const MAX_PASTED_TEXT_CHARACTERS = 10_000_000

/** Longest message body rendered as Markdown without the reader asking for it. */
export const COLLAPSE_MESSAGE_THRESHOLD = 20_000

/** Characters shown in the collapsed preview of an over-long message. */
export const COLLAPSED_PREVIEW_CHARACTERS = 2_000

/** True when a paste is large enough to travel as an attachment instead of inline text. */
export const shouldAttachPastedText = (text: string): boolean =>
  text.length > PASTE_AS_ATTACHMENT_THRESHOLD

/** True when message content is large enough to need an explicit expand before rendering. */
export const isOverlongMessage = (content: string): boolean =>
  content.length > COLLAPSE_MESSAGE_THRESHOLD

/** Cuts text to a character budget without splitting a surrogate pair. */
export const clampText = (text: string, limit: number): string =>
  text.length <= limit ? text : text.slice(0, clampSurrogateBoundary(text, limit))

/** Formats a character count with the active locale's digit grouping. */
export const formatCharacterCount = (value: number): string => value.toLocaleString()
