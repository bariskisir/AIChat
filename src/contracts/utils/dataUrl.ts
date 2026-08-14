/** Parses and validates data: URLs with optional MIME type parameters and base64 payloads. */

export interface DataUrlParts {
  mediaType: string | undefined
  isBase64: boolean
  data: string
}

/** RFC 6838 type/subtype pattern (allows image/* wildcard). */
const PROPER_MEDIA_TYPE_RE = /^[a-z]+\/[a-z0-9+.*-]+$/i

/** Parses a data: URL into its media type, base64 flag, and payload components. */
export function parseDataUrl(url: string): DataUrlParts | null {
  if (!url || typeof url !== 'string' || !url.startsWith('data:')) {
    return null
  }

  const commaIndex = url.indexOf(',')
  if (commaIndex === -1) {
    return null
  }

  const header = url.slice(5, commaIndex)
  const [rawMediaType = '', ...parameters] = header.split(';')
  const isBase64 = parameters.some((param) => param.trim().toLowerCase() === 'base64')
  const mediaType = rawMediaType.trim() || undefined
  const data = url.slice(commaIndex + 1)

  return { mediaType, isBase64, data }
}

/** Returns true if the URL is a valid base64-encoded image data URL. */
export function isBase64ImageDataUrl(url: string): boolean {
  const parsed = parseDataUrl(url)
  return parsed?.isBase64 === true && parsed.mediaType?.startsWith('image/') === true
}

/** Sanitizes a media type string to ensure RFC 6838 conformance or uses fallback. */
export function sanitizeMediaType(
  mediaType: string | undefined,
  fallback = 'application/octet-stream',
): string {
  if (mediaType && PROPER_MEDIA_TYPE_RE.test(mediaType.trim())) {
    return mediaType.trim()
  }
  return fallback
}
