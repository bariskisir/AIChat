/** Scopes model-generated <style> tags to the markdown subtree. */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyDocumentStylesToShadowRoot } from './shadowDomStyles'
import styles from './ShadowDomStyle.module.scss'

interface Props {
  children: React.ReactNode
}

/** Copies all document stylesheets into a shadow root so styles stay local. */
const ShadowDomStyle: React.FC<Props> = ({ children }) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
    copyDocumentStylesToShadowRoot(shadow)

    setShadowRoot(shadow)
  }, [])

  if (!shadowRoot) {
    return <div ref={hostRef} />
  }

  return (
    <div ref={hostRef} className={styles.host}>
      {createPortal(children, shadowRoot)}
    </div>
  )
}

export default ShadowDomStyle
