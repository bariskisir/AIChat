/** Drives a real MessageBubble to verify over-long bodies collapse and expand on demand. */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/index'
import MessageBubble from '@renderer/components/chat/MessageBubble'
import { COLLAPSE_MESSAGE_THRESHOLD } from '@renderer/utils/largeText'

vi.mock('react-i18next', () => ({
  /** Returns the key plus its interpolation values so assertions stay locale-free. */
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(',')}` : key,
  }),
}))

// Vitest runs without `globals`, so Testing Library's automatic cleanup never
// registers and rendered trees would otherwise pile up in one shared document.
afterEach(cleanup)

const noop = (): void => {}

/** Builds one complete assistant message with the requested body. */
const buildMessage = (content: string): ChatMessage => ({
  id: '00000000-0000-4000-8000-000000000001',
  role: 'assistant',
  content,
  createdAt: new Date().toISOString(),
  status: 'complete',
})

/** Renders one bubble with every action wired to a no-op. */
const renderBubble = (content: string) =>
  render(
    <MessageBubble
      message={buildMessage(content)}
      modelLabel="Test Model"
      onEdit={noop}
      onRegenerate={noop}
      onAnotherModel={noop}
      onDelete={noop}
      onBranch={noop}
    />,
  )

describe('MessageBubble long-text guard', () => {
  it('renders an ordinary message as Markdown', () => {
    const { container } = renderBubble('# Heading\n\nBody text')

    expect(container.querySelector('h1')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /chat\.showFullText/ })).toBeNull()
  })

  it('collapses an over-long body behind a character-count summary', () => {
    const content = 'x'.repeat(COLLAPSE_MESSAGE_THRESHOLD + 1)
    const { container } = renderBubble(content)

    // The full body never reaches the DOM while collapsed.
    expect(container.textContent?.includes(content)).toBe(false)
    expect(screen.getByText(/chat\.longTextCollapsed/)).toBeTruthy()
    expect(screen.getByText(/chat\.longTextCollapsed/).textContent).toContain(
      content.length.toLocaleString(),
    )
  })

  it('never runs raw HTML through the renderer while collapsed', () => {
    const content = `<div class="pasted"><table><tr><td>cell</td></tr></table></div>${'y'.repeat(
      COLLAPSE_MESSAGE_THRESHOLD,
    )}`
    const { container } = renderBubble(content)

    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('.pasted')).toBeNull()
  })

  it('renders the full body once the reader expands it', () => {
    const content = `# Expanded heading\n\n${'z'.repeat(COLLAPSE_MESSAGE_THRESHOLD)}`
    const { container } = renderBubble(content)

    fireEvent.click(screen.getByRole('button', { name: /chat\.showFullText/ }))

    expect(container.querySelector('h1')?.textContent).toBe('Expanded heading')
    expect(screen.getByRole('button', { name: /chat\.hideFullText/ })).toBeTruthy()
  })

  it('collapses again when the reader asks for it', () => {
    const content = `# Expanded heading\n\n${'z'.repeat(COLLAPSE_MESSAGE_THRESHOLD)}`
    const { container } = renderBubble(content)

    fireEvent.click(screen.getByRole('button', { name: /chat\.showFullText/ }))
    fireEvent.click(screen.getByRole('button', { name: /chat\.hideFullText/ }))

    expect(container.querySelector('h1')).toBeNull()
    expect(screen.getByText(/chat\.longTextCollapsed/)).toBeTruthy()
  })
})
