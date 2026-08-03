/** Responsive SVG renderer for markdown content. */

import { useEffect, useMemo, useRef } from 'react'
import type { Element as HastElement, RootContent } from 'hast'
import { fitSvgToContainerWidth } from '@renderer/utils/image'

/** Serializes one HAST node into an SVG-compatible HTML fragment. */
const serializeNode = (node: RootContent): string => {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'comment') {
    return `<!--${node.value}-->`
  }
  if (node.type === 'raw') {
    return node.value
  }
  if (node.type === 'doctype') {
    return ''
  }

  const attrs = Object.entries(node.properties ?? {})
    .filter(
      (entry): entry is [string, boolean | number | string | string[]] =>
        entry[1] !== null && entry[1] !== undefined && entry[1] !== false,
    )
    .map(([name, value]) => {
      const str = Array.isArray(value) ? value.join(' ') : String(value)
      return str === '' || value === true ? name : `${name}="${str.replace(/"/g, '&quot;')}"`
    })
    .join(' ')

  const children = (node.children ?? []).map(serializeNode).join('')
  const openTag = `<${node.tagName}${attrs ? ` ${attrs}` : ''}`
  return children ? `${openTag}>${children}</${node.tagName}>` : `${openTag} />`
}

/** Renders SVGs from markdown, measuring complex ones once on mount. */
const MarkdownSvg = ({
  node,
}: React.SVGProps<SVGSVGElement> & { node?: unknown }): React.JSX.Element => {
  const svgRef = useRef<SVGSVGElement>(null)
  const isMeasuredRef = useRef(false)
  const innerHtml = useMemo(() => (node ? serializeNode(node as HastElement) : ''), [node])

  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasures once the streamed SVG markup arrives
  useEffect(() => {
    const svgElement = svgRef.current
    if (svgElement?.getAttribute('data-needs-measurement') === 'true' && !isMeasuredRef.current) {
      fitSvgToContainerWidth(svgElement)
      isMeasuredRef.current = true
    }
  }, [innerHtml])

  // biome-ignore lint/security/noDangerouslySetInnerHtml: the HTML is serialized from a parsed HAST tree, not raw user input
  return <svg ref={svgRef} dangerouslySetInnerHTML={{ __html: innerHtml }} />
}

export default MarkdownSvg
