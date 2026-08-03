/** Live preview for Mermaid diagram blocks. */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useMermaid } from './useMermaid'
import ImagePreviewLayout from './ImagePreviewLayout'
import styles from '../../MessageBubble.module.scss'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './renderSvgInShadowHost'
import { useDebouncedRender } from './useDebouncedRender'

interface MermaidPreviewProps extends BasicPreviewProps {
  ref?: React.RefObject<BasicPreviewHandles | null> | undefined
}

/** Renders Mermaid source into the shadow DOM with debounced updates. */
const MermaidPreview = ({ children, ref }: MermaidPreviewProps) => {
  const { mermaid, isLoading: isLoadingMermaid, error: mermaidError, forceRenderKey } = useMermaid()
  const diagramId = useRef(`mermaid-${Math.random().toString(36).slice(2, 8)}`).current
  const [isVisible, setIsVisible] = useState(true)

  const renderMermaid = useCallback(
    async (content: string, container: HTMLDivElement) => {
      if (!mermaid) return

      await mermaid.parse(content)

      const { width } = container.getBoundingClientRect()
      if (width === 0) return

      const measureEl = document.createElement('div')
      measureEl.className = styles.mermaidMeasure ?? ''
      measureEl.dataset.measureWidth = String(width)
      document.body.appendChild(measureEl)

      try {
        const { svg } = await mermaid.render(`${diagramId}-${forceRenderKey}`, content, measureEl)

        const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)')

        renderSvgInShadowHost(fixedSvg, container)
      } finally {
        document.body.removeChild(measureEl)
      }
    },
    [diagramId, mermaid, forceRenderKey],
  )

  const shouldRender = useCallback(() => {
    return !isLoadingMermaid && isVisible
  }, [isLoadingMermaid, isVisible])

  const {
    containerRef,
    error: renderError,
    isLoading: isRendering,
  } = useDebouncedRender(children, renderMermaid, {
    debounceDelay: 300,
    shouldRender,
  })

  useEffect(() => {
    if (!containerRef.current) return

    /** Synchronizes render eligibility with the preview's effective layout visibility. */
    const checkVisibility = () => {
      const element = containerRef.current
      if (!element) return

      const currentlyVisible =
        element.offsetParent !== null && element.offsetWidth > 0 && element.offsetHeight > 0
      setIsVisible(currentlyVisible)
    }

    checkVisibility()

    const observer = new MutationObserver(() => {
      checkVisibility()
    })

    let targetElement = containerRef.current.parentElement
    while (targetElement) {
      observer.observe(targetElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
      targetElement = targetElement.parentElement
    }

    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  const isLoading = isLoadingMermaid || isRendering
  const error = mermaidError || renderError

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      ref={ref}
      imageRef={containerRef}
      source="mermaid"
    >
      <div ref={containerRef} className={styles.previewHost} />
    </ImagePreviewLayout>
  )
}

export default memo(MermaidPreview)
