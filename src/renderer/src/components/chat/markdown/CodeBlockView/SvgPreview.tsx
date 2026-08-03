/** Live preview for raw SVG diagram blocks. */

import { memo, useCallback } from 'react'
import ImagePreviewLayout from './ImagePreviewLayout'
import styles from '../../MessageBubble.module.scss'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './renderSvgInShadowHost'
import { useDebouncedRender } from './useDebouncedRender'

interface SvgPreviewProps extends BasicPreviewProps {
  ref?: React.RefObject<BasicPreviewHandles | null> | undefined
}

/** Renders SVG source into the shadow DOM with debounced updates. */
const SvgPreview = ({ children, ref }: SvgPreviewProps) => {
  const renderSvg = useCallback(async (content: string, container: HTMLDivElement) => {
    renderSvgInShadowHost(content, container)
  }, [])

  const { containerRef, error, isLoading } = useDebouncedRender(children, renderSvg, {
    debounceDelay: 300,
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      ref={ref}
      imageRef={containerRef}
      source="svg"
    >
      <div ref={containerRef} className={styles.previewHost} />
    </ImagePreviewLayout>
  )
}

export default memo(SvgPreview)
