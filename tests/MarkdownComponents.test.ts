/** Unit tests for the identity-stable Markdown component maps behind message bubbles. */

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/index'

vi.mock('@renderer/components/chat/markdown/CodeBlock', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/markdown/ImageViewer', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/markdown/MarkdownSvg', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/markdown/MarkdownTable', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/markdown/ShadowDomStyle', () => ({ default: () => null }))

import {
  createMarkdownComponents,
  useStableMarkdownComponents,
} from '@renderer/components/chat/markdown/markdownComponents'

/** Builds a minimal assistant message for the component maps. */
const message = (content: string): ChatMessage =>
  ({
    id: 'message-1',
    role: 'assistant',
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
  }) as ChatMessage

/** Invokes one renderer from the map with loosely-typed props for behavior checks. */
const invoke = (renderer: unknown, props: unknown): ReactElement =>
  (renderer as unknown as (p: unknown) => ReactElement)(props)

/** Invokes the table renderer and returns its onCopy callback. */
const tableOnCopy = (map: ReturnType<typeof createMarkdownComponents>): (() => Promise<string>) => {
  const element = invoke(map.table, {
    node: {
      position: { start: { line: 2 }, end: { line: 3 } },
    },
  })
  return (element as ReactElement<{ onCopy: () => Promise<string> }>).props.onCopy
}

describe('createMarkdownComponents', () => {
  it('exposes every renderer the Markdown pipeline requires', () => {
    const map = createMarkdownComponents(() => '')

    expect(map.a).toBeDefined()
    expect(map.code).toBeDefined()
    expect(map.table).toBeDefined()
    expect(map.img).toBeDefined()
    expect(map.svg).toBeDefined()
    expect(map.pre).toBeDefined()
    expect(map.p).toBeDefined()
    expect(map.style).toBeDefined()
  })

  it('slices table source lines from the live message content getter', async () => {
    let content = 'header\nfirst row\nsecond row'
    const map = createMarkdownComponents(() => content)
    const onCopy = tableOnCopy(map)

    expect(await onCopy()).toBe('first row\nsecond row')

    content = 'header\nthird row'
    expect(await onCopy()).toBe('third row')
  })

  it('renders image-only paragraphs as divs and text paragraphs as p', () => {
    const map = createMarkdownComponents(() => '')
    const paragraph = map.p

    const imageElement = invoke(paragraph, {
      node: { children: [{ type: 'element', tagName: 'img' }] },
    })
    expect(imageElement.type).toBe('div')

    const textElement = invoke(paragraph, {
      node: { children: [{ type: 'text', value: 'hello' }] },
    })
    expect(textElement.type).toBe('p')
  })

  it('applies the markdown pre class to fenced code containers', () => {
    const map = createMarkdownComponents(() => '')
    const preElement = invoke(map.pre, {})

    expect(String((preElement as ReactElement<{ className: string }>).props.className)).toContain(
      'markdownPre',
    )
  })
})

describe('useStableMarkdownComponents', () => {
  it('keeps one component map identity across message content changes', () => {
    const { result, rerender } = renderHook(
      ({ content }) => useStableMarkdownComponents(message(content)),
      { initialProps: { content: 'first draft' } },
    )
    const firstMap = result.current

    rerender({ content: 'second draft' })
    expect(result.current).toBe(firstMap)
    expect(result.current.table).toBe(firstMap.table)
    expect(result.current.code).toBe(firstMap.code)
  })

  it('reads the latest message content lazily after rerenders', async () => {
    const { result, rerender } = renderHook(
      ({ content }) => useStableMarkdownComponents(message(content)),
      { initialProps: { content: 'a\nb' } },
    )
    const onCopy = tableOnCopy(result.current)

    expect(await onCopy()).toBe('b')

    rerender({ content: 'x\ny\nz' })
    expect(await onCopy()).toBe('y\nz')
  })
})
