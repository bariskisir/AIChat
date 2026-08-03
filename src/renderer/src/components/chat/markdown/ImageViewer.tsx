/** Image with lightbox preview and context menu. */

import { Dropdown, Image as AntImage } from 'antd'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from '../MessageBubble.module.scss'

interface ImageViewerProps {
  src?: string | undefined
  alt?: string | undefined
  title?: string | undefined
  className?: string | undefined
  width?: string | number | undefined
  height?: string | number | undefined
}

/** Renders markdown images with a click-to-preview lightbox and copy actions. */
const ImageViewer: React.FC<ImageViewerProps> = ({ src, ...props }) => {
  const { t } = useTranslation()

  /** Fetches one image source and writes its binary data to the clipboard. */
  const handleCopyImage = async (imageSrc: string): Promise<void> => {
    try {
      const response = await fetch(imageSrc)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    } catch {
      // cross-origin fetches are blocked by CSP; silently skip
    }
  }

  if (!src) return null

  const contextMenuItems = [
    {
      key: 'copy-image',
      label: t('common.copy'),
      icon: <Copy size={14} />,
      /** Copies the rendered image bytes. */
      onClick: () => void handleCopyImage(src),
    },
    {
      key: 'copy-url',
      label: t('common.copyImageSource'),
      icon: <Copy size={14} />,
      /** Copies the original image source URL. */
      onClick: () => void navigator.clipboard.writeText(src),
    },
  ]

  return (
    <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
      <AntImage
        src={src}
        className={styles.markdownImage}
        onContextMenu={(e) => e.stopPropagation()}
        {...props}
      />
    </Dropdown>
  )
}

export default ImageViewer
