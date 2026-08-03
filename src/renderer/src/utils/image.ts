/** SVG rasterization and sizing helpers for the Markdown pipeline and diagram previews. */

const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;base64,'

/** Resolves the intrinsic drawing size of an SVG, preferring the viewBox over layout metrics. */
const svgDrawingSize = (svg: SVGElement): { width: number; height: number } => {
  const viewBoxParts = svg.getAttribute('viewBox')?.trim().split(/\s+/u).map(Number) ?? []
  const measured = svg.getBoundingClientRect()
  return {
    width: viewBoxParts[2] ?? (svg.clientWidth || measured.width),
    height: viewBoxParts[3] ?? (svg.clientHeight || measured.height),
  }
}

/** Encodes serialized markup as an SVG data URL while keeping non-Latin text intact. */
const svgMarkupToDataUrl = (markup: string): string => {
  try {
    const utf8 = new TextEncoder().encode(markup)
    const latin = Array.from(utf8, (byte) => String.fromCodePoint(byte)).join('')
    return `${SVG_DATA_URL_PREFIX}${btoa(latin)}`
  } catch {
    return `${SVG_DATA_URL_PREFIX}${btoa(decodeURIComponent(encodeURIComponent(markup)))}`
  }
}

/** Rasterizes an SVG element onto a canvas at the requested pixel density. */
export const rasterizeSvg = (svgElement: SVGElement, scale = 3): Promise<HTMLCanvasElement> => {
  const { width, height } = svgDrawingSize(svgElement)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    return Promise.reject(new Error('Canvas 2D context is unavailable'))
  }

  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))

  const image = new Image()
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    image.crossOrigin = 'anonymous'

    image.onload = () => {
      try {
        context.scale(scale, scale)
        context.drawImage(image, 0, 0, width, height)
        resolve(canvas)
      } catch (error) {
        reject(new Error(`SVG bitmap painting failed: ${String(error)}`))
      }
    }

    image.onerror = () => {
      reject(new Error('SVG source could not be decoded'))
    }

    image.src = svgMarkupToDataUrl(new XMLSerializer().serializeToString(svgElement))
  })
}

/** Rasterizes an SVG element and wraps the result in a PNG blob. */
export const svgPngBlobFrom = (svgElement: SVGElement, scale = 3): Promise<Blob> =>
  rasterizeSvg(svgElement, scale).then(
    (canvas) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Canvas could not produce a PNG blob'))
        }, 'image/png')
      }),
  )

/** Serializes an SVG element into an SVG-typed blob. */
export const svgXmlBlobFrom = (svgElement: SVGElement): Blob =>
  new Blob([new XMLSerializer().serializeToString(svgElement)], { type: 'image/svg+xml' })

/** Normalizes an SVG's dimensions so it scales with its container instead of overflowing. */
export const fitSvgToContainerWidth = (element: Element): Element => {
  if (!(element instanceof SVGElement)) {
    return element
  }

  const svg = element as SVGSVGElement
  const declaredWidth = svg.getAttribute('width')
  let intrinsicWidth: number | undefined

  if (!svg.hasAttribute('viewBox')) {
    try {
      const bounds = svg.getBBox()
      if (bounds.width > 0 && bounds.height > 0) {
        intrinsicWidth = bounds.width
        svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
      }
    } catch {
      // getBBox throws for empty SVGs; leave the markup untouched
    }
  }

  const constrainedWidth = intrinsicWidth !== undefined ? `${intrinsicWidth}px` : declaredWidth
  if (constrainedWidth && !svg.style.getPropertyValue('max-width')) {
    svg.style.setProperty('max-width', constrainedWidth)
  }

  svg.setAttribute('width', '100%')
  svg.removeAttribute('height')
  svg.removeAttribute('preserveAspectRatio')

  return element
}
