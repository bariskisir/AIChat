/** Renders a sanitized SVG string into a host element's shadow DOM. */

import DOMPurify from 'dompurify'
import { fitSvgToContainerWidth } from '@renderer/utils/image'

/**
 * Renders an SVG string inside a host element's Shadow DOM so styles stay
 * encapsulated. The SVG is sanitized before it is parsed and mounted.
 */
export function renderSvgInShadowHost(svgContent: string, hostElement: HTMLElement): void {
  if (!hostElement) {
    throw new Error('Host element for SVG rendering is not available.')
  }

  const sanitizedContent = DOMPurify.sanitize(svgContent, {
    ADD_TAGS: ['animate', 'foreignObject', 'use'],
    ADD_ATTR: ['from', 'to'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  })

  const shadowRoot = hostElement.shadowRoot || hostElement.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host {
      --shadow-host-background-color: transparent;
      --shadow-host-border: 0.5px solid var(--color-border-soft);
      --shadow-host-border-radius: 8px;

      background-color: var(--shadow-host-background-color);
      border: var(--shadow-host-border);
      border-radius: var(--shadow-host-border-radius);
      padding: 1em;
      overflow: hidden;
      white-space: normal;
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }
  `

  shadowRoot.innerHTML = ''
  shadowRoot.appendChild(style)

  if (sanitizedContent.trim() === '') {
    return
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(sanitizedContent, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  let svgElement: Element = doc.documentElement

  if (parserError || svgElement.namespaceURI !== 'http://www.w3.org/2000/svg') {
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = sanitizedContent
    const svgFromHtml = tempDiv.querySelector('svg')

    if (svgFromHtml) {
      svgElement = svgFromHtml
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    } else {
      if (parserError) {
        throw new Error(`SVG parsing error: ${parserError.textContent || 'Unknown parsing error'}`)
      }
      throw new Error(
        'Invalid SVG content: The provided string does not contain a valid SVG element.',
      )
    }
  }

  if (svgElement instanceof SVGSVGElement) {
    fitSvgToContainerWidth(svgElement)
    shadowRoot.appendChild(svgElement)
  } else {
    throw new Error('Invalid SVG content: The provided string is not a valid SVG document.')
  }
}
