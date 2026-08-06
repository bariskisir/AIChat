/**
 * Holds the latest streamed value visible for a minimum duration so short gaps in a
 * stream do not make the reasoning preview flicker away.
 */

import { useEffect, useRef, useState } from 'react'

/** Options controlling the minimum-visible-duration behaviour. */
export interface MinimumDisplayDurationOptions {
  enabled: boolean
  minimumDurationMs: number
}

/** Keeps the previous value visible until the minimum duration has elapsed. */
export const useMinimumDisplayDuration = <T>(
  nextValue: T,
  options: MinimumDisplayDurationOptions,
): T => {
  const { enabled, minimumDurationMs } = options
  const [, setRenderVersion] = useState(0)
  const displayValueRef = useRef(nextValue)
  const lastChangeAtRef = useRef(Date.now())
  const pendingValueRef = useRef<T | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    /** Clears the pending apply timer, if any. */
    const clearPendingTimer = (): void => {
      if (!timerRef.current) return
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    /** Records a newly displayed value and its timestamp. */
    const syncValue = (value: T): void => {
      displayValueRef.current = value
      lastChangeAtRef.current = Date.now()
    }

    if (Object.is(displayValueRef.current, nextValue)) {
      clearPendingTimer()
      pendingValueRef.current = null
      displayValueRef.current = nextValue
      return clearPendingTimer
    }

    if (!enabled) {
      clearPendingTimer()
      pendingValueRef.current = null
      syncValue(nextValue)
      return clearPendingTimer
    }

    if (Date.now() - lastChangeAtRef.current >= minimumDurationMs) {
      clearPendingTimer()
      pendingValueRef.current = null
      syncValue(nextValue)
      setRenderVersion((version) => version + 1)
      return clearPendingTimer
    }

    pendingValueRef.current = nextValue
    const elapsedMs = Date.now() - lastChangeAtRef.current
    const remainingMs = Math.max(0, minimumDurationMs - elapsedMs)

    clearPendingTimer()
    timerRef.current = setTimeout(() => {
      const pendingValue = pendingValueRef.current
      if (pendingValue === null) return
      pendingValueRef.current = null
      timerRef.current = null
      syncValue(pendingValue)
      setRenderVersion((version) => version + 1)
    }, remainingMs)

    return clearPendingTimer
  }, [enabled, minimumDurationMs, nextValue])

  if (!enabled || Object.is(displayValueRef.current, nextValue)) return nextValue
  return displayValueRef.current
}
