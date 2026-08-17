/**
 * Verifies that an oversized paste becomes a private text attachment carrying the
 * exact text handed to a provider, written inside the conversation's own directory.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AttachmentService from '@main/attachments/attachment.service'
import StorageService from '@main/persistence/storage.service'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}))

let rootPath = ''
let storage: StorageService
let attachments: AttachmentService

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'ai-chat-attachment-test-'))
  storage = new StorageService(rootPath)
  await storage.initialize()
  attachments = new AttachmentService(storage)
})

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true })
})

describe('AttachmentService.createFromText', () => {
  it('writes the pasted text into the conversation attachment directory', async () => {
    const conversation = await storage.createConversation()
    const text = 'pasted line\n'.repeat(2_000)

    const attachment = await attachments.createFromText(conversation.id, text)

    expect(attachment.kind).toBe('text')
    expect(attachment.mimeType).toBe('text/plain')
    expect(attachment.name).toBe('pasted-text.txt')
    expect(await readFile(attachment.localPath, 'utf8')).toBe(text)
  })

  it('carries the full text as the extracted text sent to a provider', async () => {
    const conversation = await storage.createConversation()
    const text = 'x'.repeat(50_000)

    const attachment = await attachments.createFromText(conversation.id, text)

    expect(attachment.extractedText).toBe(text)
    expect(attachment.extractedText?.length).toBe(50_000)
  })

  it('reports the byte size of multi-byte text rather than its character count', async () => {
    const conversation = await storage.createConversation()
    const text = 'çğıöşü'

    const attachment = await attachments.createFromText(conversation.id, text)

    expect(attachment.size).toBe(Buffer.byteLength(text, 'utf8'))
    expect(attachment.size).toBeGreaterThan(text.length)
  })

  it('keeps each attachment inside its own conversation directory', async () => {
    const first = await storage.createConversation()
    const second = await storage.createConversation()

    const one = await attachments.createFromText(first.id, 'one')
    const two = await attachments.createFromText(second.id, 'two')

    expect(resolve(one.localPath).startsWith(resolve(rootPath, 'attachments', first.id))).toBe(true)
    expect(resolve(two.localPath).startsWith(resolve(rootPath, 'attachments', second.id))).toBe(
      true,
    )
    expect(one.id).not.toBe(two.id)
  })
})
