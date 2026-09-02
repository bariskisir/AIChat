/**
 * Verifies generic settings and chat-conversation persistence against an isolated temporary directory.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StorageService from '@main/persistence/storage.service'

let rootPath = ''
let storage: StorageService

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'ai-chat-test-'))
  storage = new StorageService(rootPath)
  await storage.initialize()
})

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true })
})

describe('StorageService', () => {
  it('creates and lists generic conversations', async () => {
    const created = await storage.createConversation()
    const conversations = await storage.listConversations()

    expect(created.title).toBe('New Chat')
    expect(created.isDefaultTitle).toBe(true)
    expect(created.searchMode).toBe('off')
    expect(created.reasoningEffort).toBe('default')
    expect(conversations).toEqual([
      {
        id: created.id,
        title: created.title,
        isDefaultTitle: created.isDefaultTitle,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    ])
  })

  it('renames and reloads a conversation', async () => {
    const created = await storage.createConversation()
    const renamed = await storage.renameConversation(created.id, 'My Session')

    expect(renamed).toMatchObject({ title: 'My Session', isDefaultTitle: false })
    await expect(storage.getConversation(created.id)).resolves.toEqual(renamed)
  })

  it('persists the reasoning start time while a streamed reply is in progress', async () => {
    const created = await storage.createConversation()
    const reasoningStartedAt = Date.now() - 12_000
    await storage.saveConversation({
      ...created,
      messages: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          role: 'assistant',
          content: '',
          reasoning: 'Working through the request.',
          reasoningStartedAt,
          createdAt: new Date().toISOString(),
          status: 'streaming',
        },
      ],
    })

    const loaded = await storage.getConversation(created.id)

    expect(loaded.messages[0]?.reasoningStartedAt).toBe(reasoningStartedAt)
  })

  it('persists submitted batch jobs until their assistant result is written', async () => {
    const created = await storage.createConversation()
    const job = {
      batchId: 'batch-1',
      customId: 'request-1',
      requestId: 'c4c29553-3134-4998-830b-ac8ccb426900',
      conversationId: created.id,
      assistantMessageId: '5b2a29b7-2c21-4567-b292-8e5d2f333900',
      providerId: 'provider',
      modelId: 'vendor/model:batch',
      batchUrl: 'https://provider.example/api/batches',
      createdAt: '2026-01-01T00:00:00.000Z',
      missingPolls: 0,
    }

    await storage.ensureStreamingBatchMessage(
      job.conversationId,
      job.assistantMessageId,
      job.createdAt,
      [
        {
          id: '3fed0dd2-a76f-4a6f-801a-b8a4550a3900',
          role: 'user',
          content: '2 + 2',
          createdAt: job.createdAt,
          status: 'complete',
        },
      ],
      { providerId: job.providerId, modelId: job.modelId },
    )
    await storage.saveBatchJob(job)
    await storage.updateBatchJobMissingPolls(job.batchId, 1)

    expect(await storage.listBatchJobs()).toEqual([{ ...job, missingPolls: 1 }])
    expect((await storage.getConversation(created.id)).messages.at(-1)?.status).toBe('streaming')

    await storage.completeBatchMessage(job, {
      content: '4',
      reasoning: '',
      usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
    })
    await storage.removeBatchJob(job.batchId)

    expect(await storage.listBatchJobs()).toEqual([])
    expect((await storage.getConversation(created.id)).messages.at(-1)).toMatchObject({
      content: '4',
      status: 'complete',
    })
  })

  it('keeps completed batch output when a delayed renderer checkpoint is still streaming', async () => {
    const created = await storage.createConversation()
    const assistantId = '5b2a29b7-2c21-4567-b292-8e5d2f333901'
    await storage.ensureStreamingBatchMessage(
      created.id,
      assistantId,
      '2026-01-01T00:00:00.000Z',
      [],
      { providerId: 'provider', modelId: 'vendor/model:batch' },
    )
    const stale = await storage.getConversation(created.id)
    const job = {
      batchId: 'batch-2',
      customId: 'request-2',
      requestId: 'c4c29553-3134-4998-830b-ac8ccb426901',
      conversationId: created.id,
      assistantMessageId: assistantId,
      providerId: 'provider',
      modelId: 'vendor/model:batch',
      batchUrl: 'https://provider.example/api/batches',
      createdAt: '2026-01-01T00:00:00.000Z',
      missingPolls: 0,
    }

    await storage.completeBatchMessage(job, { content: '4', reasoning: '', usage: null })
    await storage.saveConversation(stale)

    expect((await storage.getConversation(created.id)).messages.at(-1)).toMatchObject({
      content: '4',
      status: 'complete',
    })
  })

  it('returns null when the renderer asks for a conversation file that was already removed', async () => {
    const created = await storage.createConversation()
    await rm(join(rootPath, 'conversations', `${created.id}.json`))

    await expect(storage.findConversation(created.id)).resolves.toBeNull()
  })

  it('replaces the final deleted chat with a fresh workspace', async () => {
    const only = await storage.createConversation()
    const result = await storage.deleteConversation(only.id)
    expect(result.deleted).toBe(true)
    expect(result.replacement?.id).not.toBe(only.id)
    expect(result.replacement?.messages).toEqual([])

    const second = await storage.createConversation()
    await expect(storage.deleteConversation(second.id)).resolves.toEqual({ deleted: true })
    expect(await storage.listConversations()).toHaveLength(1)
  })

  it('drops obsolete fields while loading older conversation documents', async () => {
    const created = await storage.createConversation()
    const filePath = join(rootPath, 'conversations', `${created.id}.json`)
    const legacy = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    await writeFile(filePath, JSON.stringify({ ...legacy, removedContent: ['old'] }), 'utf8')

    const loaded = await storage.getConversation(created.id)
    expect(loaded).toEqual(created)
    expect(loaded).not.toHaveProperty('removedContent')
  })

  it('serializes and persists settings patches', async () => {
    const saved = await storage.updateSettings({ theme: 'light', logLevel: 'debug' })
    expect(saved).toMatchObject({ theme: 'light', logLevel: 'debug' })
    await expect(storage.loadSettings()).resolves.toEqual(saved)
  })
})
