/**
 * Projects open fenced code blocks in streaming text into a lightweight
 * progress placeholder so long generated code artifacts do not run through
 * the Markdown renderer on every delta flush. Closed fences stay untouched.
 */

const FENCED_CODE_START_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/

interface CodeBlockProgress {
  language: string
  lineCount: number
  charCount: number
}

type FormatCodeBlockProgress = (progress: CodeBlockProgress) => string

interface ActiveFence {
  char: string
  minLength: number
  language: string
  lineCount: number
  charCount: number
  placeholderIndex: number
}

/** Matches a closing fence that allows up to three spaces of indentation. */
function isClosingFenceLine(
  source: string,
  start: number,
  end: number,
  fenceChar: string,
  minLength: number,
): boolean {
  let index = start
  let spaces = 0

  while (index < end && source[index] === ' ' && spaces < 4) {
    index++
    spaces++
  }

  if (spaces > 3) {
    return false
  }

  let markerLength = 0
  while (index < end && source[index] === fenceChar) {
    index++
    markerLength++
  }

  if (markerLength < minLength) {
    return false
  }

  while (
    index < end &&
    (source[index] === ' ' || source[index] === '\t' || source[index] === '\r')
  ) {
    index++
  }

  return index === end
}

/** Reads the language tag that follows an opening fence marker. */
function getFenceLanguage(meta: string, fallback: string): string {
  return meta.trim().split(/\s+/)[0] || fallback
}

/** Formats the running progress message for one projected code block. */
function formatCodeBlockPlaceholder(
  fence: ActiveFence,
  formatCodeBlockProgress: FormatCodeBlockProgress,
): string {
  return formatCodeBlockProgress({
    language: fence.language,
    lineCount: fence.lineCount,
    charCount: fence.charCount,
  })
}

/**
 * Replaces every not-yet-closed fenced code block in `content` with a single
 * progress placeholder while the model is still streaming the next delta.
 */
export function createStreamingTextProjection(
  content: string,
  formatCodeBlockProgress: FormatCodeBlockProgress,
): string {
  if (!content.includes('```') && !content.includes('~~~')) {
    return content
  }

  const projected: string[] = []
  let position = 0
  let activeFence: ActiveFence | null = null

  while (position <= content.length) {
    const nextLineBreak = content.indexOf('\n', position)
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak
    const hasLineBreak = nextLineBreak !== -1

    if (!activeFence) {
      const rawLine = content.slice(position, lineEnd)
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      const match = line.match(FENCED_CODE_START_RE)

      if (match) {
        const fenceMatch = match[2]
        if (!fenceMatch) continue
        const placeholderIndex = projected.length
        activeFence = {
          char: fenceMatch[0] ?? '',
          minLength: fenceMatch.length,
          language: getFenceLanguage(match[3] ?? '', 'code'),
          lineCount: 0,
          charCount: 0,
          placeholderIndex,
        }
        projected.push(formatCodeBlockPlaceholder(activeFence, formatCodeBlockProgress))
      } else {
        projected.push(line)
      }

      if (hasLineBreak) {
        projected.push('\n')
      }
    } else {
      const fence = activeFence as ActiveFence
      if (isClosingFenceLine(content, position, lineEnd, fence.char, fence.minLength)) {
        activeFence = null
      } else {
        fence.lineCount += 1
        fence.charCount += lineEnd - position + (hasLineBreak ? 1 : 0)
        projected[fence.placeholderIndex] = formatCodeBlockPlaceholder(
          fence,
          formatCodeBlockProgress,
        )
      }
    }

    if (!hasLineBreak) {
      break
    }

    position = lineEnd + 1
  }

  if (projected[projected.length - 1] === '\n') {
    projected.pop()
  }

  return projected.join('')
}
