/** Image with lightbox preview and context menu. */

import { Dropdown, Image as AntImage } from 'antd'
import { Copy, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { blobToDataUrl, suggestImageFileName } from '@renderer/utils/image'
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
const ImageViewer: React.FC<ImageViewerProps> = ({ src, title, alt, ...props }) => {
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

  /** Fetches one image source and writes it to a user-chosen file. */
  const handleSaveImage = async (imageSrc: string, baseName: string): Promise<void> => {
    try {
      const response = await fetch(imageSrc)
      const blob = await response.blob()
      const dataUrl = await blobToDataUrl(blob)
      await window.app.saveFile(suggestImageFileName(baseName, blob.type), dataUrl)
    } catch {
      // cross-origin fetches are blocked by CSP; silently skip
    }
  }

  if (!src) return null

  const contextMenuItems = [
    {
      key: 'save-image',
      label: t('common.saveImage'),
      icon: <Save size={14} />,
      /** Writes the rendered image bytes to a user-chosen file. */
      onClick: () => void handleSaveImage(src, title ?? alt ?? 'image'),
    },
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
