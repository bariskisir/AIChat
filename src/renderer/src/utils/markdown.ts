/** Markdown preprocessing helpers used by the chat renderer. */

const latexDelimiterScan = /\\\(.*?\\\)|\\\[.*?\\\]/s
const CODE_SPAN_REGEX = /(`{3,}[\s\S]*?`{3,}|`[^`\n]*`)/g
const MARKDOWN_LINK_REGEX = /(\[[^\]\n]*\]\([^)\n]*\))/g

/** Placeholder scheme used to protect code and link fragments during math rewrites. */
const PLACEHOLDER_PREFIX = '__AIC_HOLD_'
const PLACEHOLDER_SUFFIX = '__'

/** Builds the unique placeholder token for a protected fragment index. */
const placeholderAt = (index: number): string =>
  `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`

/** Matches any existing placeholder token so fragments can be restored later. */
const placeholderScan = (): RegExp =>
  new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g')

/** Reports whether a position carries an odd backslash-escape prefix. */
const escapedByBackslash = (text: string, index: number): boolean => {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) {
    slashes++
  }
  return slashes % 2 === 1
}

/** A balanced math delimiter span plus the text around and inside it. */
interface MathDelimiterSpan {
  start: number
  end: number
  lead: string
  body: string
  tail: string
}

/**
 * Hunts for the first balanced opener/closer pair, skipping escaped
 * delimiters and honoring inner nesting of the same opener.
 */
const findMathDelimiterSpan = (
  text: string,
  opener: string,
  closer: string,
): MathDelimiterSpan | null => {
  for (let start = 0; start <= text.length - opener.length; start++) {
    if (!text.startsWith(opener, start) || escapedByBackslash(text, start)) {
      continue
    }

    let depth = 1
    for (
      let cursor = start + opener.length;
      cursor <= text.length - closer.length && depth;
      cursor++
    ) {
      if (text.startsWith(opener, cursor) && !escapedByBackslash(text, cursor)) {
        depth++
        cursor += opener.length - 1
      } else if (text.startsWith(closer, cursor) && !escapedByBackslash(text, cursor)) {
        depth--
        if (depth === 0) {
          return {
            start,
            end: cursor + closer.length,
            lead: text.slice(0, start),
            body: text.slice(start + opener.length, cursor),
            tail: text.slice(cursor + closer.length),
          }
        }
        cursor += closer.length - 1
      }
    }
  }

  return null
}

/** Rewrites every balanced delimiter pair in `content` to its markdown math wrapper. */
const wrapMathPairs = (
  content: string,
  opener: string,
  closer: string,
  wrapper: string,
): string => {
  let output = ''
  let remaining = content

  while (remaining.length > 0) {
    const span = findMathDelimiterSpan(remaining, opener, closer)
    if (!span) {
      output += remaining
      break
    }
    output += span.lead
    output += `${wrapper}${span.body}${wrapper}`
    remaining = span.tail
  }

  return output
}

/**
 * Converts \(...\) and \[...\] LaTeX delimiters into $...$ and $$...$$ so
 * remark-math can parse them, while code blocks and links stay untouched.
 */
export const convertLatexDelimiters = (text: string): string => {
  if (!latexDelimiterScan.test(text)) {
    return text
  }

  const stashed: string[] = []

  /** Hides a fragment behind a placeholder token and returns it for splicing. */
  const stashFragment = (fragment: string): string => {
    const heldAt = stashed.length
    stashed.push(fragment)
    return placeholderAt(heldAt)
  }

  const working = text
    .replace(CODE_SPAN_REGEX, stashFragment)
    .replace(MARKDOWN_LINK_REGEX, stashFragment)

  let converted = wrapMathPairs(working, '\\[', '\\]', '$$')
  converted = wrapMathPairs(converted, '\\(', '\\)', '$')

  return converted.replace(placeholderScan(), (_match, indexToken: string) => {
    const at = Number(indexToken)
    return at >= 0 && at < stashed.length ? (stashed[at] ?? _match) : _match
  })
}

/** Removes blank lines inside <svg> blocks so they parse as raw HTML cleanly. */
export const stripBlankLinesInSvg = (text: string): string =>
  text.replace(/(<svg[\s\S]*?<\/svg>)/g, (svgBlock) =>
    svgBlock
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .join('\n'),
  )
