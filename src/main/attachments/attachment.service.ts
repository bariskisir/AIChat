/** Selects, validates, copies, and prepares chat attachments inside private app storage. */

import { randomUUID } from 'node:crypto'
import { copyFile, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { ChatAttachment } from '@shared/index'
import { parseOffice } from 'officeparser'
import type StorageService from '../persistence/storage.service'

const MAX_FILES = 10
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])
const DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
])
const EXTRACTABLE_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
])
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.log',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.htm',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.kts',
  '.sql',
  '.sh',
  '.ps1',
])

/** Resolves a browser-friendly MIME type for supported image formats. */
const imageMimeType = (extension: string): string => {
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  return 'application/octet-stream'
}

/** True when a decoded text sample looks binary rather than readable text. */
const hasBinaryIndicators = (text: string): boolean => {
  let controlCharacters = 0
  let characters = 0
  for (const character of text.slice(0, 8_000)) {
    characters += 1
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint === 0 || codePoint === 0xfffd) return true
    if (
      (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      controlCharacters += 1
    }
  }
  return controlCharacters / Math.max(characters, 1) > 0.01
}

/** Decodes a buffer as text when it plausibly is one, otherwise returns null. */
const decodeTextBufferIfText = (buffer: Buffer): string | null => {
  const text = buffer.toString('utf8')
  return hasBinaryIndicators(text) ? null : text
}

/** Owns the native file picker and bounded attachment preprocessing. */
export default class AttachmentService {
  /** Creates an attachment service backed by the application's durable storage. */
  public constructor(private readonly storage: StorageService) {}

  /** Prompts for supported files and returns up to ten validated private copies. */
  public async select(window: BrowserWindow, conversationId: string): Promise<ChatAttachment[]> {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Supported files',
          extensions: [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...TEXT_EXTENSIONS].map(
            (value) => value.slice(1),
          ),
        },
      ],
    })
    if (result.canceled) return []
    if (result.filePaths.length > MAX_FILES)
      throw new Error(`Select no more than ${MAX_FILES} files.`)
    const fileStats = await Promise.all(result.filePaths.map((filePath) => stat(filePath)))
    if (fileStats.some((value) => value.size > MAX_FILE_BYTES))
      throw new Error('Each file must be 20 MB or smaller.')
    if (fileStats.reduce((total, value) => total + value.size, 0) > MAX_TOTAL_BYTES) {
      throw new Error('Attachments must total 50 MB or less.')
    }
    const directory = await this.storage.ensureAttachmentDirectory(conversationId)
    return Promise.all(
      result.filePaths.map((filePath, index) =>
        this.prepareFile(filePath, fileStats[index]?.size ?? 0, directory),
      ),
    )
  }

  /** Copies one file and prepares either an image data URL or bounded readable text. */
  private async prepareFile(
    filePath: string,
    size: number,
    directory: string,
  ): Promise<ChatAttachment> {
    const id = randomUUID()
    const extension = extname(filePath).toLowerCase()
    const name = basename(filePath)
    const localPath = join(directory, `${id}${extension}`)
    await copyFile(filePath, localPath)
    if (IMAGE_EXTENSIONS.has(extension)) {
      const mimeType = imageMimeType(extension)
      const data = await readFile(localPath)
      return {
        id,
        name,
        mimeType,
        size,
        localPath,
        kind: 'image',
        dataUrl: `data:${mimeType};base64,${data.toString('base64')}`,
      }
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      const text = (await readFile(localPath, 'utf8')).slice(0, 250_000)
      return {
        id,
        name,
        mimeType: 'text/plain',
        size,
        localPath,
        kind: 'text',
        extractedText: text,
      }
    }
    if (!extension) {
      const decoded = decodeTextBufferIfText(await readFile(localPath))
      if (decoded !== null) {
        return {
          id,
          name,
          mimeType: 'text/plain',
          size,
          localPath,
          kind: 'text',
          extractedText: decoded.slice(0, 250_000),
        }
      }
    }
    let extractedText = 'This document is attached, but no plain-text preview was available.'
    if (EXTRACTABLE_DOCUMENT_EXTENSIONS.has(extension)) {
      try {
        extractedText = (await parseOffice(localPath)).toText().slice(0, 250_000)
      } catch {
        // Unsupported or damaged documents remain attached with a safe metadata fallback.
      }
    }
    return {
      id,
      name,
      mimeType: 'application/octet-stream',
      size,
      localPath,
      kind: 'document',
      extractedText,
    }
  }
}
