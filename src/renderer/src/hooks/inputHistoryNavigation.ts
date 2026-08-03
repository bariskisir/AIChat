/**
 * Pure input-history navigation helpers for the chat composer.
 */

export type InputHistoryDirection = 'up' | 'down'

interface NextInputHistoryIndexParams {
  currentIndex: number
  direction: InputHistoryDirection
  messagesLength: number
}

/** Advances the history index for one ArrowUp/ArrowDown step. */
export function getNextInputHistoryIndex({
  currentIndex,
  direction,
  messagesLength,
}: NextInputHistoryIndexParams): number {
  if (messagesLength === 0) {
    return currentIndex
  }

  if (direction === 'up') {
    return currentIndex < messagesLength - 1 ? currentIndex + 1 : currentIndex
  }

  if (currentIndex > 0) {
    return currentIndex - 1
  }

  if (currentIndex === 0) {
    return -1
  }

  return currentIndex
}

/** True when the key event should be consumed by input-history navigation. */
export function shouldHandleInputHistoryNavigation(params: {
  isAllSelected: boolean
  isComposing: boolean
  isCursorAtEnd: boolean
  key: string
  text: string
}): boolean {
  const { isAllSelected, isComposing, isCursorAtEnd, key, text } = params

  if (isComposing) {
    return false
  }

  if (key !== 'ArrowUp' && key !== 'ArrowDown') {
    return false
  }

  return text.trim().length === 0 || isAllSelected || isCursorAtEnd
}
