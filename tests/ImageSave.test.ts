/** Unit tests for the image save-as helpers shared by the markdown image viewer. */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  blobToDataUrl,
  imageExtensionFromMime,
  sanitizeImageFileName,
  suggestImageFileName,
} from '@renderer/utils/image'

describe('imageExtensionFromMime', () => {
  it('maps known image MIME types to their file extensions', () => {
    expect(imageExtensionFromMime('image/png')).toBe('.png')
    expect(imageExtensionFromMime('image/jpeg')).toBe('.jpg')
    expect(imageExtensionFromMime('image/webp')).toBe('.webp')
    expect(imageExtensionFromMime('image/gif')).toBe('.gif')
    expect(imageExtensionFromMime('image/svg+xml')).toBe('.svg')
    expect(imageExtensionFromMime('image/avif')).toBe('.avif')
  })

  it('falls back to PNG for unknown MIME types', () => {
    expect(imageExtensionFromMime('application/octet-stream')).toBe('.png')
  })
})

describe('sanitizeImageFileName', () => {
  it('strips filesystem-hostile characters from the base name', () => {
    expect(sanitizeImageFileName('diagram <1> : v2*')).toBe('diagram--1----v2-')
  })

  it('falls back to a timestamped name when the base name is empty', () => {
    expect(sanitizeImageFileName('   ')).toMatch(/^image-\d{4}-\d{2}-\d{6}$/u)
  })
})

describe('suggestImageFileName', () => {
  it('combines a sanitized base name with the MIME extension', () => {
    expect(suggestImageFileName('architecture sketch', 'image/png')).toBe('architecture-sketch.png')
    expect(suggestImageFileName('bad/name', 'image/jpeg')).toBe('bad-name.jpg')
  })
})

describe('blobToDataUrl', () => {
  it('encodes a blob as a base64 data URL', async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' })

    await expect(blobToDataUrl(blob)).resolves.toBe('data:image/png;base64,AQIDBA==')
  })
})
