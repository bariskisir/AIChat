/** Code-block view and preview component contracts. */

/** Visual arrangement of a code block's source and preview panes. */
export type ViewMode = 'special' | 'source' | 'split'

/** Props shared by every special-preview component. */
export interface BasicPreviewProps {
  children: string
}

/** Imperative API previews expose to the code-block toolbar. */
export interface BasicPreviewHandles {
  copy: () => Promise<void>
  download: (format: 'svg' | 'png') => Promise<void>
}
