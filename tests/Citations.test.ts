/** Verifies citation tag generation and recursive data-citation lookup. */

import { describe, expect, it } from 'vitest'
import type { Citation } from '@shared/index'
import {
  citationHostname,
  findCitationInChildren,
  withCitationTags,
} from '../src/renderer/src/utils/citations'

const citations: Citation[] = [
  {
    index: 1,
    title: 'Example News',
    url: 'https://example.com/article',
    snippet: 'A useful snippet.',
  },
  { index: 2, title: 'Second Source', url: 'https://second.org/page', snippet: 'Another snippet.' },
]

describe('withCitationTags', () => {
  it('returns content unchanged when there are no citations', () => {
    expect(withCitationTags('plain text [1]', [])).toBe('plain text [1]')
  })

  it('converts bracketed numbers into data-citation superscript links', () => {
    const result = withCitationTags('Answer [1] and also [2].', citations)
    expect(result).toContain("[<sup data-citation='")
    expect(result).toContain('data-citation=')
    expect(result).toContain('(https://example.com/article)')
    expect(result).toContain('(https://second.org/page)')
    expect(result).not.toContain('[cite:')
  })

  it('leaves unknown numbers untouched', () => {
    expect(withCitationTags('Answer [3].', citations)).toBe('Answer [3].')
  })

  it('skips citation markers inside code blocks', () => {
    const result = withCitationTags('```\n[1]\n```\n[2]', citations)
    expect(result).toContain('```\n[1]\n```')
    expect(result).toContain('data-citation=')
  })

  it('escapes quotes in the embedded JSON payload', () => {
    const result = withCitationTags('[1]', [
      { index: 1, title: "It's", url: 'https://example.com/a', snippet: 'say "hi"' },
    ])
    expect(result).not.toContain('{"')
    expect(result).toContain('&#39;')
    expect(result).toContain('&quot;')
  })

  it('escapes pipe characters so tables parse correctly', () => {
    const result = withCitationTags('[1]', [
      { index: 1, title: 'Pipe', url: 'https://example.com/a|b', snippet: 'x | y' },
    ])
    expect(result).toContain('&#124;')
  })
})

describe('citationHostname', () => {
  it('extracts the hostname from a URL', () => {
    expect(citationHostname('https://example.com/path')).toBe('example.com')
  })

  it('falls back to the raw string for invalid URLs', () => {
    expect(citationHostname('not a url')).toBe('not a url')
  })
})

describe('findCitationInChildren', () => {
  it('finds a data-citation payload in nested element children', () => {
    const children = ['text', { props: { children: [{ props: { 'data-citation': '{"id":1}' } }] } }]
    expect(findCitationInChildren(children)).toBe('{"id":1}')
  })

  it('returns an empty string when nothing matches', () => {
    expect(findCitationInChildren(['text', { props: { children: 'more' } }])).toBe('')
  })

  it('returns an empty string for empty children', () => {
    expect(findCitationInChildren(undefined)).toBe('')
  })
})
