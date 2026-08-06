/** Verifies wheel-zoom handling for SVG previews consumes modifier-wheel events. */

import { describe, expect, it, vi } from 'vitest'
import { createWheelZoomHandler } from '@renderer/components/chat/markdown/CodeBlockView/useImageTools'

/** Builds a fake container whose containment check can be controlled. */
const container = (contains: (target: unknown) => boolean) =>
  ({ contains }) as unknown as HTMLElement

/** Builds a fake wheel event with the given modifier and delta state. */
const wheelEvent = (
  target: unknown,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; deltaY?: number } = {},
): WheelEvent =>
  ({
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    deltaY: modifiers.deltaY ?? 0,
    target,
    preventDefault: vi.fn(),
  }) as unknown as WheelEvent

describe('createWheelZoomHandler', () => {
  it('zooms in and prevents default when ctrl+wheel scrolls up over the preview', () => {
    const zoom = vi.fn()
    const preventDefault = vi.fn()
    const event = wheelEvent({}, { ctrlKey: true, deltaY: -1 })
    event.preventDefault = preventDefault

    createWheelZoomHandler(
      container(() => true),
      zoom,
    )(event)

    expect(zoom).toHaveBeenCalledWith(0.1)
    expect(preventDefault).toHaveBeenCalled()
  })

  it('zooms out for a downward meta+wheel gesture', () => {
    const zoom = vi.fn()
    const event = wheelEvent({}, { metaKey: true, deltaY: 1 })

    createWheelZoomHandler(
      container(() => true),
      zoom,
    )(event)

    expect(zoom).toHaveBeenCalledWith(-0.1)
  })

  it('leaves unmodified wheel input to the scroll parent', () => {
    const zoom = vi.fn()
    const preventDefault = vi.fn()
    const event = wheelEvent({}, { deltaY: -1 })
    event.preventDefault = preventDefault

    createWheelZoomHandler(
      container(() => true),
      zoom,
    )(event)

    expect(zoom).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('ignores modifier-wheel events that originate outside the preview', () => {
    const zoom = vi.fn()
    const event = wheelEvent({}, { ctrlKey: true, deltaY: -1 })

    createWheelZoomHandler(
      container(() => false),
      zoom,
    )(event)

    expect(zoom).not.toHaveBeenCalled()
  })

  it('ignores events without a target', () => {
    const zoom = vi.fn()
    const event = wheelEvent(null, { ctrlKey: true, deltaY: -1 })

    createWheelZoomHandler(
      container(() => true),
      zoom,
    )(event)

    expect(zoom).not.toHaveBeenCalled()
  })
})
