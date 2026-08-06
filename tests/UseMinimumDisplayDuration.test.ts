/** Unit tests for the minimum display duration hook behind the thinking preview. */

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMinimumDisplayDuration } from '@renderer/components/chat/useMinimumDisplayDuration'

const MINIMUM_DURATION_MS = 1_000

describe('useMinimumDisplayDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Renders the hook with the given props, allowing controlled rerenders. */
  const render = (value: string, enabled = true, minimumDurationMs = MINIMUM_DURATION_MS) =>
    renderHook(({ next }) => useMinimumDisplayDuration(next, { enabled, minimumDurationMs }), {
      initialProps: { next: value },
    })

  it('passes the value through while it stays unchanged', () => {
    const { result, rerender } = render('a')

    expect(result.current).toBe('a')
    rerender({ next: 'a' })
    expect(result.current).toBe('a')
  })

  it('applies every change immediately while disabled', () => {
    const { result, rerender } = render('a', false)

    rerender({ next: 'b' })
    expect(result.current).toBe('b')
  })

  it('keeps the previous value until the minimum duration has elapsed', () => {
    const { result, rerender } = render('a')

    rerender({ next: 'b' })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(MINIMUM_DURATION_MS - 1)
    })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('b')
  })

  it('applies a change immediately when the minimum duration already elapsed', () => {
    const { result, rerender } = render('a')

    act(() => {
      vi.advanceTimersByTime(MINIMUM_DURATION_MS + 500)
    })
    rerender({ next: 'b' })
    expect(result.current).toBe('b')
  })

  it('prefers the latest value over intermediate ones while waiting', () => {
    const { result, rerender } = render('a')

    rerender({ next: 'b' })
    rerender({ next: 'c' })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(MINIMUM_DURATION_MS)
    })
    expect(result.current).toBe('c')
  })

  it('restarts the minimum duration on every mid-stream change', () => {
    const { result, rerender } = render('a')

    rerender({ next: 'b' })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(result.current).toBe('a')

    rerender({ next: 'c' })
    act(() => {
      vi.advanceTimersByTime(399)
    })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('c')
  })
})
