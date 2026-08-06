/** Pan, zoom, copy, download, and dialog controls for SVG previews. */

import type { RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { svgPngBlobFrom, svgXmlBlobFrom } from '@renderer/utils/image'
import { useTheme } from '@renderer/context/ThemeProvider'

/** Options for configuring the image tooling. */
export interface ImageToolsOptions {
  prefix: string
  imgSelector: string
  enableDrag?: boolean
  enableWheelZoom?: boolean
}

/** Creates the wheel handler that zooms a preview and consumes the event before page scrolling. */
export const createWheelZoomHandler = (
  container: HTMLElement,
  zoom: (delta: number) => void,
): ((event: WheelEvent) => void) => {
  return (event: WheelEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.target) {
      if (container.contains(event.target as Node)) {
        event.preventDefault()
        zoom(event.deltaY < 0 ? 0.1 : -0.1)
      }
    }
  }
}

/** Imperative preview controls backed by a container element. */
export const useImageTools = (
  containerRef: RefObject<HTMLDivElement | null>,
  options: ImageToolsOptions,
): {
  pan: (dx: number, dy: number, absolute?: boolean) => void
  zoom: (delta: number, absolute?: boolean) => void
  copy: () => Promise<void>
  download: (format: 'svg' | 'png') => Promise<void>
} => {
  const transformRef = useRef({ scale: 1, x: 0, y: 0 })
  const { imgSelector, prefix, enableDrag, enableWheelZoom } = options
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { theme } = useTheme()

  const getImgElement = useCallback(() => {
    if (!containerRef.current) return null

    const shadowRoot = containerRef.current.shadowRoot
    if (shadowRoot) {
      return shadowRoot.querySelector(imgSelector) as SVGElement | null
    }

    return containerRef.current.querySelector(imgSelector) as SVGElement | null
  }, [containerRef, imgSelector])

  const getCleanImgElement = useCallback((): SVGElement | null => {
    const imgElement = getImgElement()
    if (!imgElement) return null

    const clonedElement = imgElement.cloneNode(true) as SVGElement
    clonedElement.style.transform = ''
    clonedElement.style.transformOrigin = ''
    return clonedElement
  }, [getImgElement])

  const getCurrentPosition = useCallback(() => {
    const imgElement = getImgElement()
    if (!imgElement) return transformRef.current

    const transform = imgElement.style.transform
    if (!transform || transform === 'none') return transformRef.current

    const matrix = new DOMMatrix(transform)
    return { x: matrix.m41, y: matrix.m42 }
  }, [getImgElement])

  const applyTransform = useCallback(
    (element: SVGElement | null, x: number, y: number, scale: number) => {
      if (!element) return
      element.style.transformOrigin = 'top left'
      element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    },
    [],
  )

  const pan = useCallback(
    (dx: number, dy: number, absolute = false) => {
      const currentPos = getCurrentPosition()
      const newX = absolute ? dx : currentPos.x + dx
      const newY = absolute ? dy : currentPos.y + dy

      transformRef.current.x = newX
      transformRef.current.y = newY

      applyTransform(getImgElement(), newX, newY, transformRef.current.scale)
    },
    [getCurrentPosition, getImgElement, applyTransform],
  )

  useEffect(() => {
    if (!enableDrag || !containerRef.current) return

    const container = containerRef.current
    const startPos = { x: 0, y: 0 }

    /** Applies the current pointer delta while an image is being dragged. */
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startPos.x
      const dy = e.clientY - startPos.y

      const newX = transformRef.current.x + dx
      const newY = transformRef.current.y + dy

      applyTransform(getImgElement(), newX, newY, transformRef.current.scale)
      e.preventDefault()
    }

    /** Commits the final image translation and removes drag listeners. */
    const handleMouseUp = (e: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)

      container.style.cursor = 'default'

      const dx = e.clientX - startPos.x
      const dy = e.clientY - startPos.y
      transformRef.current.x += dx
      transformRef.current.y += dy
    }

    /** Starts primary-button image panning from its current translated position. */
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return

      const currentPos = getCurrentPosition()
      transformRef.current.x = currentPos.x
      transformRef.current.y = currentPos.y

      startPos.x = e.clientX
      startPos.y = e.clientY

      container.style.cursor = 'grabbing'
      e.preventDefault()

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    container.addEventListener('mousedown', handleMouseDown)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [containerRef, getImgElement, applyTransform, getCurrentPosition, enableDrag])

  const zoom = useCallback(
    (delta: number, absolute = false) => {
      const newScale = absolute
        ? Math.max(0.1, Math.min(3, delta))
        : Math.max(0.1, Math.min(3, transformRef.current.scale + delta))

      transformRef.current.scale = newScale

      applyTransform(getImgElement(), transformRef.current.x, transformRef.current.y, newScale)
    },
    [getImgElement, applyTransform],
  )

  useEffect(() => {
    if (!enableWheelZoom || !containerRef.current) return

    const container = containerRef.current
    const handleWheel = createWheelZoomHandler(container, zoom)

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [containerRef, zoom, enableWheelZoom])

  const copy = useCallback(async () => {
    try {
      const imgElement = getCleanImgElement()
      if (!imgElement) return

      const blob = await svgPngBlobFrom(imgElement)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      message.success(t('common.copied'))
    } catch {
      message.error(t('codeBlock.copy.failed'))
    }
  }, [getCleanImgElement, message, t])

  const download = useCallback(
    async (format: 'svg' | 'png') => {
      try {
        const imgElement = getCleanImgElement()
        if (!imgElement) return

        const timestamp = Date.now()

        if (format === 'svg') {
          const blob = svgXmlBlobFrom(imgElement)
          const url = URL.createObjectURL(blob)
          triggerDownload(url, `${prefix}-${timestamp}.svg`)
          URL.revokeObjectURL(url)
        } else {
          const blob = await svgPngBlobFrom(imgElement)
          const pngUrl = URL.createObjectURL(blob)
          triggerDownload(pngUrl, `${prefix}-${timestamp}.png`)
          URL.revokeObjectURL(pngUrl)
        }
      } catch {
        message.error(t('codeBlock.download.failed'))
      }
    },
    [getCleanImgElement, prefix, message, t],
  )

  useEffect(() => {
    // theme is intentional: reset the viewport transform when the diagram re-renders
    void theme
    pan(0, 0, true)
    zoom(1, true)
  }, [pan, zoom, theme])

  return { zoom, pan, copy, download }
}

/** Triggers a browser-style download of a blob URL. */
const triggerDownload = (url: string, filename: string): void => {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}
