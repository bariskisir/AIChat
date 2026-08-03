/** Prepares SVG elements for scalable rendering. */

import type { Element, Root } from 'hast'

/** Walks every HAST element depth-first and invokes one visitor. */
const walk = (node: Element | Root, visit: (node: Element) => void): void => {
  if (node.type === 'element') visit(node)
  const children = 'children' in node ? node.children : []
  for (const child of children) {
    if (child.type === 'element') walk(child, visit)
  }
}

/** Reports whether a raw SVG dimension is a finite plain numeric value. */
const isNumeric = (value: unknown): boolean => {
  if (typeof value === 'string' && value.trim() !== '') {
    return String(parseFloat(value)) === value.trim()
  }
  return false
}

/**
 * Classifies SVGs into simple (viewBox added, fixed dimensions removed) and
 * complex (flagged with data-needs-measurement for runtime processing).
 */
function rehypeScalableSvg() {
  return (tree: Root) => {
    walk(tree, (node: Element) => {
      if (node.tagName !== 'svg') return

      const properties = node.properties
      const hasViewBox = 'viewBox' in properties
      const width = (properties.width as string)?.trim()
      const height = (properties.height as string)?.trim()

      if (width) {
        const existingStyle = properties.style
          ? String(properties.style).trim().replace(/;$/, '')
          : ''
        const maxWidth = `max-width: ${width}`
        properties.style = existingStyle ? `${existingStyle}; ${maxWidth}` : maxWidth
      }

      if (!hasViewBox && isNumeric(width) && isNumeric(height)) {
        properties.viewBox = `0 0 ${width} ${height}`
        properties.width = '100%'
        delete properties.height
      } else if (!hasViewBox && width && height) {
        properties['data-needs-measurement'] = 'true'
      }
    })
  }
}

export default rehypeScalableSvg
