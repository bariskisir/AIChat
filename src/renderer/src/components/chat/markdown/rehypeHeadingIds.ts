/** GitHub-style heading slug ids. */

import type { Element, ElementContent, Root, Text } from 'hast'

/** Walks every HAST element depth-first and invokes one visitor. */
const walk = (node: Element | Root, visit: (node: Element) => void): void => {
  if (node.type === 'element') visit(node)
  const children = 'children' in node ? node.children : []
  for (const child of children) {
    if (child.type === 'element') walk(child, visit)
  }
}

/** Creates a collision-aware heading slug generator. */
export function createSlugger() {
  const seen = new Map<string, number>()

  /** Normalizes arbitrary heading text into a stable URL-safe base slug. */
  const normalize = (text: string): string => {
    const slug = (text || 'section')
      .toLowerCase()
      .trim()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/["'`(){}[\]:;!?.,]/g, '')
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')

    return slug
  }

  /** Appends a deterministic occurrence counter to one normalized heading slug. */
  const slug = (text: string): string => {
    const base = normalize(text)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return `${base}-${count}`
  }

  return { slug }
}

/** Recursively extracts visible plain text from one HAST node. */
export function extractTextFromNode(node: ElementContent): string {
  if (typeof (node as Text).value === 'string') {
    return (node as Text).value
  }

  if ((node as Element).children?.length) {
    return (node as Element).children.map(extractTextFromNode).join('')
  }

  return ''
}

/** Assigns unique deterministic IDs to every Markdown heading. */
export default function rehypeHeadingIds(options?: { prefix?: string }) {
  return (tree: Root) => {
    const slugger = createSlugger()
    const prefix = options?.prefix ? `${options.prefix}--` : ''

    walk(tree, (node) => {
      if (!/^h[1-6]$/.test(node.tagName)) return
      const text = extractTextFromNode(node)
      const id = prefix + slugger.slug(text)
      node.properties = node.properties || {}
      if (!node.properties.id) node.properties.id = id
    })
  }
}
