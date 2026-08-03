/** Citation tag utilities for marking search sources inline. */

import type { Citation } from '@shared/index'

/** Parsed payload embedded in a rendered citation link's data-citation attribute. */
export interface CitationTagData {
  id: number
  url: string
  title: string
  content: string
}

/** HTML metacharacters and their attribute-safe entity replacements. */
const ATTRIBUTE_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})

/** Escapes HTML metacharacters so a JSON payload can live inside an attribute value. */
const escapeAttributeValue = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ATTRIBUTE_ENTITIES[char] ?? char)

/** Replaces pipes with their entity so GFM table cells do not split on them. */
const pipeSafe = (value: string): string => value.replace(/\|/g, '&#124;')

/** Percent-encodes pipes inside link destinations so table cells stay intact. */
const urlPipeSafe = (url: string): string => url.replace(/\|/g, '%7C')

/** Extracts the hostname from a URL, falling back to the raw string. */
export const citationHostname = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Fenced or inline code spans that must never receive citation markers. */
const CODE_SPAN_PATTERN = /(```[\s\S]*?```|`[^`\n]*`)/g

/** Splits markdown content into alternating prose/code segments, keeping code intact. */
const splitCodeSegments = (content: string): string[] => content.split(CODE_SPAN_PATTERN)

/** True for every other split segment, which holds the protected code spans. */
const isCodeSegmentIndex = (index: number): boolean => index % 2 === 1

/** Converts [N] markers in markdown content into clickable citation tags. */
export function withCitationTags(content: string, citations: Citation[]): string {
  if (!content || citations.length === 0) return content

  const citationMap = new Map(citations.map((citation) => [citation.index, citation]))
  const segments = splitCodeSegments(content)

  for (let index = 0; index < segments.length; index += 1) {
    if (isCodeSegmentIndex(index)) continue
    segments[index] = markKnownCitations(segments[index] ?? '', citationMap)
  }

  return segments.join('').replace(/\[cite:(\d+)\]/g, (match, num) => {
    const citation = citationMap.get(parseInt(num, 10))
    return citation ? buildCitationTag(citation) : match
  })
}

/** Rewrites [N] markers that match a known citation into [cite:N] placeholders. */
const markKnownCitations = (segment: string, citationMap: Map<number, Citation>): string =>
  segment.replace(/\[(\d+)\]/g, (match, num) => {
    const citationNum = parseInt(num, 10)
    return citationMap.has(citationNum) ? `[cite:${citationNum}]` : match
  })

/**
 * Builds a markdown link around a <sup> element carrying the citation metadata:
 * [<sup data-citation='...'>N</sup>](url)
 */
function buildCitationTag(citation: Citation): string {
  const supData: CitationTagData = {
    id: citation.index,
    url: citation.url,
    title: citation.title || citationHostname(citation.url),
    content: citation.snippet?.substring(0, 200) ?? '',
  }
  // Pipes are entity-escaped (and URL pipes percent-escaped) so the GFM table
  // parser never treats them as column separators
  const citationJson = pipeSafe(escapeAttributeValue(JSON.stringify(supData)))

  const isLink = citation.url?.startsWith('http') ?? false
  const safeUrl = isLink ? urlPipeSafe(citation.url) : ''

  return `[<sup data-citation='${citationJson}'>${citation.index}</sup>]${isLink ? `(${safeUrl})` : '()'}`
}

/** Recursively finds the data-citation payload among React element children. */
export const findCitationInChildren = (children: unknown): string => {
  if (!children) return ''

  const pending = Array.isArray(children) ? [...children] : [children]
  while (pending.length > 0) {
    const child = pending.pop()
    if (typeof child !== 'object' || child === null) continue
    const element = child as { props?: { 'data-citation'?: string; children?: unknown } }
    if (element.props?.['data-citation']) {
      return element.props['data-citation']
    }
    if (element.props?.children) {
      const nested = element.props.children
      if (Array.isArray(nested)) pending.push(...nested)
      else pending.push(nested)
    }
  }

  return ''
}
