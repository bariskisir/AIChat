/** Live preview for PlantUML diagram blocks served by the public PlantUML endpoint. */

import { deflateRaw } from 'pako'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ImagePreviewLayout from './ImagePreviewLayout'
import styles from '../../MessageBubble.module.scss'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './renderSvgInShadowHost'
import { useDebouncedRender } from './useDebouncedRender'

const PLANTUML_ENDPOINT = 'https://www.plantuml.com/plantuml'

/** The 64-symbol alphabet PlantUML uses instead of the standard base64 table. */
const SEXTET_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

/** Maps a six-bit value to its PlantUML alphabet character. */
const sextetChar = (value: number): string => SEXTET_ALPHABET[value & 0x3f] ?? '?'

/** Spreads up to three bytes across four PlantUML alphabet characters. */
const bytesToSextets = (first: number, second: number, third: number): string =>
  sextetChar(first >> 2) +
  sextetChar(((first & 0x03) << 4) | (second >> 4)) +
  sextetChar(((second & 0x0f) << 2) | (third >> 6)) +
  sextetChar(third & 0x3f)

/** Deflates and alphabet-encodes diagram source for the PlantUML endpoint. */
const compressDiagramSource = (source: string): string => {
  const raw = deflateRaw(new TextEncoder().encode(source))
  let encoded = ''
  for (let offset = 0; offset < raw.length; offset += 3) {
    encoded += bytesToSextets(raw[offset] ?? 0, raw[offset + 1] ?? 0, raw[offset + 2] ?? 0)
  }
  return encoded
}

/** Builds the public PlantUML request URL for one output format. */
const plantUmlUrlFor = (format: 'png' | 'svg', source: string): string =>
  `${PLANTUML_ENDPOINT}/${format}/${compressDiagramSource(source)}`

export interface PlantUmlPreviewProps extends BasicPreviewProps {
  ref?: React.RefObject<BasicPreviewHandles | null> | undefined
}

/** Renders PlantUML source by fetching an SVG from the public server. */
const PlantUmlPreview = ({ children, ref }: PlantUmlPreviewProps) => {
  const { t } = useTranslation()

  /** Fetches and mounts the latest PlantUML SVG while localizing server failures. */
  const renderPlantUml = useCallback(
    async (content: string, container: HTMLDivElement) => {
      const response = await fetch(plantUmlUrlFor('svg', content))
      if (!response.ok) {
        if (response.status === 400) {
          throw new Error(t('preview.plantUmlSyntaxError'))
        }
        if (response.status >= 500) {
          throw new Error(t('preview.plantUmlUnavailable', { status: response.status }))
        }
        throw new Error(
          t('preview.plantUmlServerError', {
            status: response.status,
            statusText: response.statusText,
          }),
        )
      }

      const markup = await response.text()
      renderSvgInShadowHost(markup, container)
    },
    [t],
  )

  const { containerRef, error, isLoading } = useDebouncedRender(children, renderPlantUml, {
    debounceDelay: 300,
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      ref={ref}
      imageRef={containerRef}
      source="plantuml"
    >
      <div ref={containerRef} className={`${styles.previewHost} ${styles.previewHostWhite}`} />
    </ImagePreviewLayout>
  )
}

export default memo(PlantUmlPreview)
