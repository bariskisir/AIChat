/** Stores validated settings and complete chat conversations as local JSON documents. */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  AppSettings,
  AppSettingsPatch,
  ChatMessage,
  Conversation,
  ConversationSummary,
  DeleteConversationResult,
  ModelReference,
  TokenUsage,
} from '@shared/index'
import { MAX_CHAT_ERROR_LENGTH, REASONING_EFFORTS, WEB_SEARCH_MODES } from '@shared/index'
import { clampSurrogateBoundary } from '@shared/index'
import { z } from 'zod'
import { parsePersistedSettings, settingsSchema } from '../config/settings.schema'

/** Accepts known levels plus future server-supplied extras such as `max`. */
const reasoningEffortSchema = z.union([z.enum(REASONING_EFFORTS), z.string().min(1).max(50)])

const modelReferenceSchema = z.object({ providerId: z.string().min(1), modelId: z.string().min(1) })
const attachmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(500),
  mimeType: z.string().max(200),
  size: z.number().int().nonnegative(),
  localPath: z.string().min(1),
  kind: z.enum(['image', 'text', 'document']),
  extractedText: z.string().optional(),
  dataUrl: z.string().optional(),
})
const citationSchema = z.object({
  index: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  snippet: z.string(),
})
const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
const searchQueryStatusSchema = z.object({
  query: z.string(),
  engine: z.string().max(20),
  count: z.number().int(),
  done: z.boolean().optional(),
})
const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant', 'system', 'boundary']),
  content: z.string(),
  reasoning: z.string().optional(),
  model: modelReferenceSchema.optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  citations: z.array(citationSchema).max(15).optional(),
  searchQueries: z.array(searchQueryStatusSchema).max(10).optional(),
  usage: tokenUsageSchema.optional(),
  tokenCount: z.number().int().nonnegative().optional(),
  reasoningStartedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime(),
  status: z.enum(['complete', 'streaming', 'stopped', 'error']),
  error: z.string().max(MAX_CHAT_ERROR_LENGTH).optional(),
})
const conversationSchema = z.object({
  revision: z.literal(1),
  id: z.uuid(),
  title: z.string().min(1).max(200),
  isDefaultTitle: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: z.array(messageSchema),
  selectedModel: modelReferenceSchema.nullable(),
  searchMode: z.enum(WEB_SEARCH_MODES),
  lastSearchEngine: z.enum(['google', 'bing', 'duckduckgo']),
  useWebSearchFallback: z.boolean(),
  reasoningEffort: reasoningEffortSchema,
})

/** Stores one submitted asynchronous batch request until its final result is persisted. */
export interface PersistedBatchJob {
  batchId: string
  customId: string
  requestId: string
  conversationId: string
  assistantMessageId: string
  providerId: string
  modelId: string
  batchUrl: string
  createdAt: string
  missingPolls: number
}

/** Holds the versioned local queue of submitted provider batch jobs. */
interface BatchJobFile {
  revision: 1
  jobs: PersistedBatchJob[]
}

const batchJobSchema = z.object({
  batchId: z.string().min(1).max(2_000),
  customId: z.string().min(1).max(2_000),
  requestId: z.uuid(),
  conversationId: z.uuid(),
  assistantMessageId: z.uuid(),
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(500),
  batchUrl: z.url().max(2_000),
  createdAt: z.iso.datetime(),
  missingPolls: z.number().int().nonnegative(),
})
const batchJobFileSchema = z.object({ revision: z.literal(1), jobs: z.array(batchJobSchema) })

const DEFAULT_CONVERSATION_TITLE = 'New Chat'

/** Adds conversation defaults to sparse documents written by the former generic shell. */
const normalizeConversation = (input: unknown): unknown => {
  if (!input || typeof input !== 'object') return input
  const value = input as Record<string, unknown>
  return {
    revision: 1,
    id: value.id,
    title: value.title,
    isDefaultTitle: value.isDefaultTitle ?? true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages: value.messages ?? [],
    selectedModel: value.selectedModel ?? null,
    searchMode: value.searchMode ?? 'off',
    lastSearchEngine: value.lastSearchEngine ?? 'google',
    useWebSearchFallback: value.useWebSearchFallback ?? true,
    reasoningEffort: value.reasoningEffort ?? 'default',
  }
}

/** Rejects identifiers that could escape the conversation directory. */
const assertConversationId = (id: string): void => {
  if (!z.uuid().safeParse(id).success) throw new Error('Invalid conversation identifier.')
}

/** Serializes settings and chat-conversation access inside the private application directory. */
export default class StorageService {
  private readonly settingsPath: string
  private readonly conversationsPath: string
  private readonly attachmentsPath: string
  private readonly batchJobsPath: string
  private readonly fileOperationTails = new Map<string, Promise<void>>()
  private readonly conversationWrites = new Set<string>()

  /** Creates a storage service rooted in AI Chat's private durable data directory. */
  public constructor(private readonly rootPath: string) {
    this.settingsPath = join(rootPath, 'settings.json')
    this.conversationsPath = join(rootPath, 'conversations')
    this.attachmentsPath = join(rootPath, 'attachments')
    this.batchJobsPath = join(rootPath, 'batch-jobs.json')
  }

  /** Creates all durable directories. */
  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.rootPath, { recursive: true }),
      mkdir(this.conversationsPath, { recursive: true }),
      mkdir(this.attachmentsPath, { recursive: true }),
    ])
    await Promise.all([
      this.removeObsoleteTemporaryFiles(this.rootPath),
      this.removeObsoleteTemporaryFiles(this.conversationsPath),
    ])
  }

  /** Returns the private attachment directory for one validated conversation. */
  public async ensureAttachmentDirectory(conversationId: string): Promise<string> {
    assertConversationId(conversationId)
    const directory = join(this.attachmentsPath, conversationId)
    await mkdir(directory, { recursive: true })
    return directory
  }

  /** Loads validated application settings or returns safe defaults. */
  public async loadSettings(): Promise<AppSettings> {
    return this.withFileLock(this.settingsPath, () => this.readSettingsUnlocked())
  }

  /** Reads settings while its caller owns the settings-file lock. */
  private async readSettingsUnlocked(): Promise<AppSettings> {
    try {
      return parsePersistedSettings(
        JSON.parse(await readFile(this.settingsPath, 'utf8')) as unknown,
      )
    } catch {
      return parsePersistedSettings(null)
    }
  }

  /** Validates and replaces the complete application settings document. */
  public async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const validated = settingsSchema.parse(settings)
    await this.writeJsonFile(this.settingsPath, validated)
    return validated
  }

  /** Atomically merges a validated renderer settings patch into current settings. */
  public async updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.withFileLock(this.settingsPath, async () => {
      const validated = settingsSchema.parse({ ...(await this.readSettingsUnlocked()), ...patch })
      await this.writeJsonFileUnlocked(this.settingsPath, validated)
      return validated
    })
  }

  /** Creates a new empty chat conversation. */
  public async createConversation(title?: string): Promise<Conversation> {
    const now = new Date().toISOString()
    const normalizedTitle = title?.trim().slice(0, clampSurrogateBoundary(title.trim(), 200))
    const conversation: Conversation = {
      revision: 1,
      id: randomUUID(),
      title: normalizedTitle || DEFAULT_CONVERSATION_TITLE,
      isDefaultTitle: !normalizedTitle,
      createdAt: now,
      updatedAt: now,
      messages: [],
      selectedModel: null,
      searchMode: 'off',
      lastSearchEngine: 'google',
      useWebSearchFallback: true,
      reasoningEffort: 'default',
    }
    this.conversationWrites.add(conversation.id)
    return this.saveConversation(conversation)
  }

  /** Loads one validated complete chat conversation by identifier. */
  public async getConversation(id: string): Promise<Conversation> {
    assertConversationId(id)
    const filePath = this.conversationPath(id)
    return this.withFileLock(filePath, () => this.readConversationUnlocked(filePath))
  }

  /** Loads one conversation or returns null when a stale renderer reference points to a deleted file. */
  public async findConversation(id: string): Promise<Conversation | null> {
    try {
      return await this.getConversation(id)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** Validates and persists a complete conversation after renderer state changes. */
  public async saveConversation(conversation: Conversation): Promise<Conversation> {
    const filePath = this.conversationPath(conversation.id)
    return this.withFileLock(filePath, async () => {
      const normalized = conversationSchema.parse({
        ...conversation,
        updatedAt: new Date().toISOString(),
      })
      if (!existsSync(filePath) && !this.conversationWrites.has(normalized.id)) {
        return normalized
      }
      let persisted: Conversation | null = null
      try {
        persisted = await this.readConversationUnlocked(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const validated = persisted
        ? conversationSchema.parse(this.mergeCompletedBatchMessages(normalized, persisted))
        : normalized
      this.assertAttachmentPaths(validated)
      this.conversationWrites.delete(validated.id)
      await this.writeJsonFileUnlocked(filePath, validated)
      return validated
    })
  }

  /** Lists every submitted batch job that still awaits its final provider result. */
  public async listBatchJobs(): Promise<PersistedBatchJob[]> {
    return this.withFileLock(
      this.batchJobsPath,
      async () => (await this.readBatchJobsUnlocked()).jobs,
    )
  }

  /** Persists a submitted batch job before it is first eligible for polling. */
  public async saveBatchJob(job: PersistedBatchJob): Promise<void> {
    const validated = batchJobSchema.parse(job)
    await this.withFileLock(this.batchJobsPath, async () => {
      const file = await this.readBatchJobsUnlocked()
      file.jobs = [...file.jobs.filter((item) => item.batchId !== validated.batchId), validated]
      await this.writeJsonFileUnlocked(this.batchJobsPath, batchJobFileSchema.parse(file))
    })
  }

  /** Updates the count of consecutive not-found responses while a new batch becomes visible. */
  public async updateBatchJobMissingPolls(batchId: string, missingPolls: number): Promise<void> {
    await this.withFileLock(this.batchJobsPath, async () => {
      const file = await this.readBatchJobsUnlocked()
      const job = file.jobs.find((item) => item.batchId === batchId)
      if (!job) return
      job.missingPolls = missingPolls
      await this.writeJsonFileUnlocked(this.batchJobsPath, batchJobFileSchema.parse(file))
    })
  }

  /** Removes a settled or intentionally abandoned batch job from the local queue. */
  public async removeBatchJob(batchId: string): Promise<void> {
    await this.withFileLock(this.batchJobsPath, async () => {
      const file = await this.readBatchJobsUnlocked()
      const jobs = file.jobs.filter((item) => item.batchId !== batchId)
      if (jobs.length === file.jobs.length) return
      await this.writeJsonFileUnlocked(this.batchJobsPath, { ...file, jobs })
    })
  }

  /** Restores the durable request and its assistant placeholder before a batch result is available. */
  public async ensureStreamingBatchMessage(
    conversationId: string,
    assistantMessageId: string,
    createdAt: string,
    messages: ChatMessage[],
    model: ModelReference,
  ): Promise<Conversation | null> {
    try {
      return await this.updateConversation(conversationId, (conversation) => {
        const messageIds = new Set(conversation.messages.map((message) => message.id))
        for (const message of messages) {
          if (!messageIds.has(message.id)) conversation.messages.push(message)
        }
        const assistant = conversation.messages.find((message) => message.id === assistantMessageId)
        if (assistant) {
          assistant.status = 'streaming'
          delete assistant.error
          return
        }
        conversation.messages.push({
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          model,
          createdAt,
          status: 'streaming',
        })
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** Writes a completed batch response directly into its durable assistant message. */
  public async completeBatchMessage(
    job: PersistedBatchJob,
    result: { content: string; reasoning: string; usage: TokenUsage | null },
  ): Promise<Conversation | null> {
    return this.updateBatchMessage(job, (message) => {
      message.content = result.content
      if (result.reasoning) message.reasoning = result.reasoning
      if (result.usage) message.usage = result.usage
      message.status = 'complete'
      message.durationMs = Math.max(0, Date.now() - Date.parse(message.createdAt))
      delete message.error
    })
  }

  /** Writes a terminal batch failure directly into its durable assistant message. */
  public async failBatchMessage(
    job: PersistedBatchJob,
    error: string,
  ): Promise<Conversation | null> {
    return this.updateBatchMessage(job, (message) => {
      message.status = 'error'
      message.error = error.slice(0, MAX_CHAT_ERROR_LENGTH)
      message.durationMs = Math.max(0, Date.now() - Date.parse(message.createdAt))
    })
  }

  /** Lists compact conversation summaries ordered by most recent update. */
  public async listConversations(): Promise<ConversationSummary[]> {
    const entries = await readdir(this.conversationsPath, { withFileTypes: true })
    const documents = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => this.tryReadConversation(join(this.conversationsPath, entry.name))),
    )
    return documents
      .filter((document): document is Conversation => document !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ id, title, isDefaultTitle, createdAt, updatedAt }) => ({
        id,
        title,
        isDefaultTitle,
        createdAt,
        updatedAt,
      }))
  }

  /** Replaces a generated title with a validated user or Quick Model title. */
  public async renameConversation(id: string, title: string): Promise<Conversation> {
    const trimmed = title.trim()
    const normalizedTitle = trimmed.slice(0, clampSurrogateBoundary(trimmed, 200))
    if (!normalizedTitle) throw new Error('Chat title cannot be empty.')
    return this.updateConversation(id, (conversation) => {
      conversation.title = normalizedTitle
      conversation.isDefaultTitle = false
    })
  }

  /** Deletes a conversation; deleting the final conversation creates and returns a fresh replacement. */
  public async deleteConversation(id: string): Promise<DeleteConversationResult> {
    assertConversationId(id)
    return this.withFileLock(this.conversationsPath, async () => {
      const conversations = await this.listConversations()
      if (!conversations.some((conversation) => conversation.id === id)) return { deleted: false }
      try {
        await this.withFileLock(this.conversationPath(id), () => unlink(this.conversationPath(id)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (conversations.length === 1) {
        return { deleted: true, replacement: await this.createConversation() }
      }
      return { deleted: true }
    })
  }

  /** Deletes every conversation and returns a fresh empty conversation as the replacement. */
  public async deleteAllConversations(): Promise<Conversation> {
    return this.withFileLock(this.conversationsPath, async () => {
      const conversations = await this.listConversations()
      for (const conversation of conversations) {
        try {
          await this.withFileLock(this.conversationPath(conversation.id), () =>
            unlink(this.conversationPath(conversation.id)),
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return this.createConversation()
    })
  }

  /** Reads one conversation while tolerating unrelated malformed history files. */
  private async tryReadConversation(filePath: string): Promise<Conversation | null> {
    try {
      return await this.withFileLock(filePath, () => this.readConversationUnlocked(filePath))
    } catch {
      return null
    }
  }

  /** Applies one serialized conversation mutation and persists its updated timestamp. */
  private async updateConversation(
    id: string,
    update: (conversation: Conversation) => void,
  ): Promise<Conversation> {
    assertConversationId(id)
    const filePath = this.conversationPath(id)
    return this.withFileLock(filePath, async () => {
      const conversation = await this.readConversationUnlocked(filePath)
      update(conversation)
      conversation.updatedAt = new Date().toISOString()
      const validated = conversationSchema.parse(conversation)
      await this.writeJsonFileUnlocked(filePath, validated)
      return validated
    })
  }

  /** Keeps completed batch output when a delayed renderer checkpoint still describes it as streaming. */
  private mergeCompletedBatchMessages(
    incoming: Conversation,
    persisted: Conversation,
  ): Conversation {
    const completedById = new Map(
      persisted.messages
        .filter(
          (message) =>
            message.role === 'assistant' &&
            (message.status === 'complete' || message.status === 'error'),
        )
        .map((message) => [message.id, message]),
    )
    if (completedById.size === 0) return incoming
    const messages = incoming.messages.map((message) => {
      const completed = completedById.get(message.id)
      return message.status === 'streaming' && completed ? completed : message
    })
    const incomingIds = new Set(messages.map((message) => message.id))
    for (const completed of completedById.values()) {
      if (!incomingIds.has(completed.id)) messages.push(completed)
    }
    return { ...incoming, messages }
  }

  /** Applies one durable batch-message mutation unless its conversation was deleted. */
  private async updateBatchMessage(
    job: PersistedBatchJob,
    update: (message: ChatMessage) => void,
  ): Promise<Conversation | null> {
    try {
      return await this.updateConversation(job.conversationId, (conversation) => {
        const message = conversation.messages.find((item) => item.id === job.assistantMessageId)
        if (!message) return
        update(message)
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** Reads and normalizes a conversation while its caller owns the file lock. */
  private async readConversationUnlocked(filePath: string): Promise<Conversation> {
    return conversationSchema.parse(
      normalizeConversation(JSON.parse(await readFile(filePath, 'utf8')) as unknown),
    )
  }

  /** Reads the durable batch queue while its caller owns the batch-queue lock. */
  private async readBatchJobsUnlocked(): Promise<BatchJobFile> {
    try {
      return batchJobFileSchema.parse(
        JSON.parse(await readFile(this.batchJobsPath, 'utf8')) as unknown,
      )
    } catch {
      return { revision: 1, jobs: [] }
    }
  }

  /** Resolves a validated conversation identifier to its durable JSON path. */
  private conversationPath(id: string): string {
    return join(this.conversationsPath, `${id}.json`)
  }

  /** Ensures persisted attachment references cannot escape their conversation's private directory. */
  private assertAttachmentPaths(conversation: Conversation): void {
    const directory = resolve(this.attachmentsPath, conversation.id)
    for (const attachment of conversation.messages.flatMap(
      (message) => message.attachments ?? [],
    )) {
      const pathFromDirectory = relative(directory, resolve(attachment.localPath))
      if (pathFromDirectory.startsWith('..') || isAbsolute(pathFromDirectory)) {
        throw new Error('Invalid attachment path.')
      }
    }
  }

  /** Serializes a JSON write behind the destination file's operation lock. */
  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await this.withFileLock(filePath, () => this.writeJsonFileUnlocked(filePath, value))
  }

  /** Atomically replaces one JSON payload while its caller owns the file lock. */
  private async writeJsonFileUnlocked(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, filePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  /** Runs one operation after all prior operations targeting the same path. */
  private async withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.fileOperationTails.get(filePath) ?? Promise.resolve()
    /** Releases the current path queue after this operation completes. */
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.fileOperationTails.set(filePath, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.fileOperationTails.get(filePath) === tail) this.fileOperationTails.delete(filePath)
    }
  }

  /** Removes only stale temporary artifacts created by former direct-write builds. */
  private async removeObsoleteTemporaryFiles(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.allSettled(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
        .map((entry) => unlink(join(directoryPath, entry.name))),
    )
  }
}
