/** Verifies streaming code-block projection used to keep long streams lightweight. */

import { describe, expect, it } from 'vitest'
import { createStreamingTextProjection } from '../src/renderer/src/utils/streamingProjection'

const formatProgress = ({
  language,
  lineCount,
  charCount,
}: {
  language: string
  lineCount: number
  charCount: number
}) => `${language} ${lineCount} ${charCount}`

describe('createStreamingTextProjection', () => {
  it('keeps text without fenced code unchanged', () => {
    expect(createStreamingTextProjection('hello\nworld', formatProgress)).toBe('hello\nworld')
  })

  it('replaces fenced code content with a lightweight placeholder', () => {
    const content = [
      'Before',
      '```html',
      '<html><body>large streaming artifact</body></html>',
      '```',
      'After',
    ].join('\n')

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toContain('Before')
    expect(projected).toContain('After')
    expect(projected).toContain('html 1 51')
    expect(projected).not.toContain('large streaming artifact')
    expect(projected).not.toContain('```html')
  })

  it('replaces open fenced code content until the stream completes', () => {
    const content = ['Before', '```tsx', 'const value = "still streaming"'].join('\n')

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toBe(['Before', 'tsx 1 31'].join('\n'))
    expect(projected).not.toContain('still streaming')
  })

  it('handles multiple fenced code blocks', () => {
    const content = [
      'A',
      '```ts',
      'const first = 1',
      '```',
      'B',
      '~~~html',
      '<div>second</div>',
      '~~~',
      'C',
    ].join('\n')

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toBe(['A', 'ts 1 16', 'B', 'html 1 18', 'C'].join('\n'))
    expect(projected).not.toContain('const first')
    expect(projected).not.toContain('<div>second</div>')
  })

  it('recognizes closing fences with CRLF line endings', () => {
    const content = ['```ts\r', 'const value = 1\r', '```\r', 'after'].join('\n')

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toBe(['ts 1 17', 'after'].join('\n'))
    expect(projected).not.toContain('const value')
  })

  it('falls back to a code label when fenced code has no language', () => {
    const content = ['```', 'plain text', '```'].join('\n')

    expect(createStreamingTextProjection(content, formatProgress)).toBe('code 1 11')
  })
})
