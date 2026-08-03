/** Shared loading, error, and copy/download shell for diagram previews. */

import { Spin } from 'antd'
import { memo, useImperativeHandle } from 'react'
import styles from '../../MessageBubble.module.scss'
import type { BasicPreviewHandles } from './types'
import { useImageTools } from './useImageTools'

interface ImagePreviewLayoutProps {
  children: React.ReactNode
  ref?: React.RefObject<BasicPreviewHandles | null> | undefined
  imageRef: React.RefObject<HTMLDivElement | null>
  source: string
  loading?: boolean | undefined
  error?: string | null | undefined
}

/** Wraps a preview container with loading and error handling. */
const ImagePreviewLayout = ({
  children,
  ref,
  imageRef,
  source,
  loading,
  error,
}: ImagePreviewLayoutProps) => {
  const { copy, download } = useImageTools(imageRef, {
    imgSelector: 'svg',
    prefix: source ?? 'svg',
    enableDrag: true,
    enableWheelZoom: true,
  })

  useImperativeHandle(ref, () => {
    return {
      copy,
      download,
    }
  })

  return (
    <Spin spinning={Boolean(loading)}>
      <div role="alert" className={styles.previewContainer}>
        {error && <div className={styles.previewError}>{error}</div>}
        {children}
      </div>
    </Spin>
  )
}

export default memo(ImagePreviewLayout)
