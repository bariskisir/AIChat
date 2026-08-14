import { describe, expect, it } from 'vitest'
import {
  isBase64ImageDataUrl,
  parseDataUrl,
  sanitizeMediaType,
} from '../src/contracts/utils/dataUrl'

describe('dataUrl utilities', () => {
  it('parses standard base64 image data URLs', () => {
    const parsed = parseDataUrl('data:image/png;base64,iVBORw0KGgo=')
    expect(parsed).toEqual({
      mediaType: 'image/png',
      isBase64: true,
      data: 'iVBORw0KGgo=',
    })
    expect(isBase64ImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
  })

  it('parses base64 data URLs with parameters', () => {
    const parsed = parseDataUrl('data:image/jpeg;name=photo.jpg;base64,/9j/4AAQSkZJRg==')
    expect(parsed).toEqual({
      mediaType: 'image/jpeg',
      isBase64: true,
      data: '/9j/4AAQSkZJRg==',
    })
    expect(isBase64ImageDataUrl('data:image/jpeg;name=photo.jpg;base64,/9j/4AAQSkZJRg==')).toBe(
      true,
    )
  })

  it('parses data URLs with charset parameter', () => {
    const parsed = parseDataUrl('data:text/html;charset=utf-8;base64,PGgxPkhlbGxvPC9oMT4=')
    expect(parsed).toEqual({
      mediaType: 'text/html',
      isBase64: true,
      data: 'PGgxPkhlbGxvPC9oMT4=',
    })
    expect(isBase64ImageDataUrl('data:text/html;charset=utf-8;base64,PGgxPkhlbGxvPC9oMT4=')).toBe(
      false,
    )
  })

  it('rejects invalid or non-data URLs', () => {
    expect(parseDataUrl('https://example.com/image.png')).toBeNull()
    expect(parseDataUrl('')).toBeNull()
    expect(isBase64ImageDataUrl('data:text/plain,Hello')).toBe(false)
  })

  it('sanitizes malformed media types with fallback', () => {
    expect(sanitizeMediaType('image/png')).toBe('image/png')
    expect(sanitizeMediaType('application/pdf')).toBe('application/pdf')
    expect(sanitizeMediaType('.png', 'image/png')).toBe('image/png')
    expect(sanitizeMediaType('invalid', 'application/octet-stream')).toBe(
      'application/octet-stream',
    )
    expect(sanitizeMediaType(undefined, 'application/octet-stream')).toBe(
      'application/octet-stream',
    )
  })
})
