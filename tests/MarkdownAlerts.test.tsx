/** Smoke tests for GitHub-style blockquote alerts in the Markdown pipeline. */

// @vitest-environment jsdom

import { render } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import remarkAlert from 'remark-github-blockquote-alert'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'

describe('GitHub blockquote alerts', () => {
  it('renders a NOTE alert with the expected marker classes', () => {
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkAlert]}>
        {'> [!NOTE]\n> Alert body'}
      </ReactMarkdown>,
    )

    const alert = container.querySelector('.markdown-alert')
    expect(alert).not.toBeNull()
    expect(alert?.classList.contains('markdown-alert-note')).toBe(true)
    expect(container.textContent).toContain('Alert body')
  })

  it('renders a WARNING alert as a warning marker', () => {
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkAlert]}>
        {'> [!WARNING]\n> Careful here'}
      </ReactMarkdown>,
    )

    const alert = container.querySelector('.markdown-alert')
    expect(alert?.classList.contains('markdown-alert-warning')).toBe(true)
  })

  it('keeps plain blockquotes unchanged', () => {
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkAlert]}>{'> Just a quote'}</ReactMarkdown>,
    )

    expect(container.querySelector('.markdown-alert')).toBeNull()
    expect(container.querySelector('blockquote')).not.toBeNull()
  })
})
