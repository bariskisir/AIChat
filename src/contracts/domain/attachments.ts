/** Defines file attachments copied into private application storage for a conversation. */

/** A file attached to a locally persisted conversation. */
export interface ChatAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  localPath: string
  kind: 'image' | 'text' | 'document'
  extractedText?: string | undefined
  dataUrl?: string | undefined
}
