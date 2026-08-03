/**
 * Persistent chat-composer input history backed by localStorage.
 * Deduplicates exact matches and keeps the latest 20 entries.
 */

import { useCallback, useRef, useState } from 'react'
import { getNextInputHistoryIndex, type InputHistoryDirection } from './inputHistoryNavigation'

export const INPUT_HISTORY_LIMIT = 20
const INPUT_HISTORY_STORAGE_KEY = 'aichat.composer.input_history'

interface UseInputHistoryOptions {
  applyDraft: (text: string) => void
}

const readStoredHistory = (): string[] => {
  try {
    const raw = localStorage.getItem(INPUT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, INPUT_HISTORY_LIMIT)
  } catch {
    return []
  }
}

const writeStoredHistory = (history: string[]): void => {
  try {
    localStorage.setItem(INPUT_HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch {
    // best-effort persistence; history simply does not survive the session
  }
}

/** Provides ArrowUp/ArrowDown navigation over recently submitted prompts. */
export function useInputHistory({ applyDraft }: UseInputHistoryOptions) {
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [history, setHistory] = useState<string[]>(() => readStoredHistory())
  const draftBeforeHistoryRef = useRef<string | null>(null)
  const navigationHistoryRef = useRef<string[] | null>(null)

  const applyHistoryIndex = useCallback(
    (nextIndex: number) => {
      setHistoryIndex(nextIndex)
      if (nextIndex === -1) {
        applyDraft(draftBeforeHistoryRef.current ?? '')
        draftBeforeHistoryRef.current = null
        navigationHistoryRef.current = null
        return
      }

      const activeHistory = navigationHistoryRef.current ?? history
      const historyItem = activeHistory[nextIndex]
      if (historyItem === undefined) {
        applyDraft(draftBeforeHistoryRef.current ?? '')
        draftBeforeHistoryRef.current = null
        navigationHistoryRef.current = null
        setHistoryIndex(-1)
        return
      }

      applyDraft(historyItem)
    },
    [applyDraft, history],
  )

  const navigateHistory = useCallback(
    (direction: InputHistoryDirection, currentDraft: string): boolean => {
      const activeHistory = navigationHistoryRef.current ?? history
      const nextIndex = getNextInputHistoryIndex({
        currentIndex: historyIndex,
        direction,
        messagesLength: activeHistory.length,
      })

      if (nextIndex === historyIndex) {
        return historyIndex !== -1
      }

      if (historyIndex === -1 && nextIndex !== -1) {
        draftBeforeHistoryRef.current = currentDraft
        navigationHistoryRef.current = history
      }
      applyHistoryIndex(nextIndex)
      return true
    },
    [applyHistoryIndex, history, historyIndex],
  )

  const resetHistoryIndex = useCallback(() => {
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = null
    navigationHistoryRef.current = null
  }, [])

  const saveHistory = useCallback((content: string) => {
    const normalizedContent = content.trim()
    if (!normalizedContent) return
    setHistory((prev) => {
      const next = [normalizedContent, ...prev.filter((item) => item !== normalizedContent)].slice(
        0,
        INPUT_HISTORY_LIMIT,
      )
      writeStoredHistory(next)
      return next
    })
  }, [])

  return {
    historyIndex,
    navigateHistory,
    resetHistoryIndex,
    saveHistory,
  }
}
