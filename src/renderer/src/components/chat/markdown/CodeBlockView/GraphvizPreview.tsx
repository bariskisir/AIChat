/** Live preview for Graphviz (dot / graphviz) diagram blocks. */

import { memo, useCallback } from 'react'
import type * as VizModule from '@viz-js/viz'
import ImagePreviewLayout from './ImagePreviewLayout'
import styles from '../../MessageBubble.module.scss'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './renderSvgInShadowHost'
import { useDebouncedRender } from './useDebouncedRender'

type VizInstance = Awaited<ReturnType<typeof VizModule.instance>>

let vizInstance: VizInstance | null = null
let vizLoading: Promise<VizInstance> | null = null

/** Loads the Viz engine once and reuses the instance. */
const getVizInstance = (): Promise<VizInstance> => {
  if (vizInstance) return Promise.resolve(vizInstance)
  if (vizLoading) return vizLoading

  vizLoading = import('@viz-js/viz')
    .then((module) => module.instance())
    .then((instance) => {
      vizInstance = instance
      return instance
    })
    .finally(() => {
      vizLoading = null
    })

  return vizLoading
}

interface GraphvizPreviewProps extends BasicPreviewProps {
  ref?: React.RefObject<BasicPreviewHandles | null> | undefined
}

/** Renders Graphviz source into the shadow DOM with debounced updates. */
const GraphvizPreview = ({ children, ref }: GraphvizPreviewProps) => {
  const renderGraphviz = useCallback(async (content: string, container: HTMLDivElement) => {
    const viz = await getVizInstance()
    const svg = viz.renderString(content, { format: 'svg' })
    renderSvgInShadowHost(svg, container)
  }, [])

  const { containerRef, error, isLoading } = useDebouncedRender(children, renderGraphviz, {
    debounceDelay: 300,
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      ref={ref}
      imageRef={containerRef}
      source="graphviz"
    >
      <div ref={containerRef} className={`${styles.previewHost} ${styles.previewHostWhite}`} />
    </ImagePreviewLayout>
  )
}

export default memo(GraphvizPreview)
