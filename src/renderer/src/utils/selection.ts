/** Extracts selected text while preserving original TeX formulas for KaTeX renderings. */

const TEXT_BLOCK_TAGS = new Set([
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'P',
  'PRE',
  'TR',
])

/**
 * Extracts text content from a Selection, restoring KaTeX formulas to their TeX source and
 * filtering out line numbers in code viewers.
 */
export function extractSelectedTextWithKatex(selection: Selection | null): string {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }

  const range = selection.getRangeAt(0).cloneRange()
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  const endElement =
    range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const startKatex = startElement?.closest('.katex')
  const endKatex = endElement?.closest('.katex')

  if (startKatex) range.setStartBefore(startKatex)
  if (endKatex) range.setEndAfter(endKatex)

  const fragment = range.cloneContents()
  const hasLineNumbers = fragment.querySelectorAll('.line-number').length > 0
  const katexMathMlElements = fragment.querySelectorAll('.katex-mathml')
  const hasKatex = katexMathMlElements.length > 0

  if (!hasLineNumbers && !hasKatex) {
    return selection.toString()
  }

  fragment.querySelectorAll('.line-number').forEach((element) => {
    element.remove()
  })
  fragment.querySelectorAll('.katex-mathml + .katex-html').forEach((element) => {
    element.remove()
  })
  katexMathMlElements.forEach((element) => {
    const texSource = element.querySelector('annotation')?.textContent
    if (texSource !== null && texSource !== undefined) {
      element.replaceWith(document.createTextNode(texSource))
    }
  })

  const walker = document.createTreeWalker(
    fragment,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null,
  )

  let result = ''
  let node = walker.nextNode()

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      if (element.tagName === 'BR') {
        result += '\n'
      } else if (
        result.length > 0 &&
        !result.endsWith('\n') &&
        (TEXT_BLOCK_TAGS.has(element.tagName) || element.classList.contains('line'))
      ) {
        result += '\n'
      }
    }
    node = walker.nextNode()
  }

  return result
}
