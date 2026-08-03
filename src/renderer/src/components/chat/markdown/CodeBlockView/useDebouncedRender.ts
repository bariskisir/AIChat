/** Debounced rendering control for code-block diagram previews. */

import { startTransition, useCallback, useEffect, useRef, useState } from 'react'

/** Options for throttling and gating preview re-renders. */
export interface DebouncedRenderOptions {
  /** How long to wait after content changes before re-rendering. */
  debounceDelay?: number
  /** Optional gate deciding whether a render should run at all. */
  shouldRender?: () => boolean
}

/** State and controls returned by useDebouncedRender. */
export interface DebouncedRenderResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  error: string | null
  isLoading: boolean
  triggerRender: (content: string) => void
  cancelRender: () => void
  clearError: () => void
  setLoading: (loading: boolean) => void
}

/** Schedules asynchronous preview rendering after a quiet period. */
export const useDebouncedRender = (
  value: string,
  renderFunction: (content: string, container: HTMLDivElement) => Promise<void>,
  options: DebouncedRenderOptions = {},
): DebouncedRenderResult => {
  const { debounceDelay = 300, shouldRender } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  /** Runs the render function against the mounted container and reports failures. */
  const performRender = useCallback(
    async (content: string): Promise<void> => {
      if ((shouldRender && !shouldRender()) || !content) {
        return
      }

      const host = containerRef.current
      if (!host) {
        throw new Error('Preview container has not been mounted')
      }

      try {
        setIsLoading(true)
        await renderFunction(content, host)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Preview rendering failed')
      } finally {
        setIsLoading(false)
      }
    },
    [renderFunction, shouldRender],
  )

  /** Queues a render after the quiet period, replacing any earlier pending one. */
  const scheduleRender = useCallback(
    (content: string): void => {
      if (pendingTimer.current !== null) {
        clearTimeout(pendingTimer.current)
      }
      pendingTimer.current = setTimeout(() => {
        pendingTimer.current = null
        startTransition(() => {
          void performRender(content)
        })
      }, debounceDelay)
    },
    [debounceDelay, performRender],
  )

  /** Clears any pending render timer and drops the loading flag. */
  const cancelRender = useCallback((): void => {
    if (pendingTimer.current !== null) {
      clearTimeout(pendingTimer.current)
      pendingTimer.current = null
    }
    setIsLoading(false)
  }, [])

  const triggerRender = useCallback(
    (content: string): void => {
      if (content) {
        setIsLoading(true)
        scheduleRender(content)
      } else {
        cancelRender()
        setError(null)
      }
    },
    [scheduleRender, cancelRender],
  )

  const clearError = useCallback((): void => {
    setError(null)
  }, [])

  const setLoading = useCallback((loading: boolean): void => {
    setIsLoading(loading)
  }, [])

  useEffect(() => {
    if (value) {
      triggerRender(value)
    } else {
      cancelRender()
    }
    return cancelRender
  }, [value, triggerRender, cancelRender])

  return {
    containerRef,
    error,
    isLoading,
    triggerRender,
    cancelRender,
    clearError,
    setLoading,
  }
}
