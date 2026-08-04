/** Centralized Zod schemas for every validated IPC boundary. */

import {
  LOG_LEVELS,
  MAX_CHAT_ERROR_LENGTH,
  PROVIDER_TYPES,
  REASONING_EFFORTS,
  WEB_SEARCH_MODES,
} from '@shared/index'
import { z } from 'zod'

export const idSchema = z.string().min(1).max(200)
export const conversationIdSchema = z.uuid()
export const modelReferenceSchema = z.object({ providerId: idSchema, modelId: idSchema })

export const attachmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(500),
  mimeType: z.string().max(200),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
  localPath: z.string().min(1),
  kind: z.enum(['image', 'text', 'document']),
  extractedText: z.string().max(250_000).optional(),
  dataUrl: z.string().max(30_000_000).optional(),
})

export const citationSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().max(500),
  url: z.url(),
  snippet: z.string().max(2_000),
})

export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})

export const searchQueryStatusSchema = z.object({
  query: z.string().max(500),
  engine: z.string().max(20),
  count: z.number().int(),
  done: z.boolean().optional(),
})

export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant', 'system', 'boundary']),
  content: z.string().max(2_000_000),
  reasoning: z.string().max(2_000_000).optional(),
  model: modelReferenceSchema.optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  citations: z.array(citationSchema).max(10).optional(),
  searchQueries: z.array(searchQueryStatusSchema).max(10).optional(),
  usage: tokenUsageSchema.optional(),
  tokenCount: z.number().int().nonnegative().optional(),
  reasoningStartedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime(),
  status: z.enum(['complete', 'streaming', 'stopped', 'error']),
  error: z.string().max(MAX_CHAT_ERROR_LENGTH).optional(),
})

export const conversationSchema = z.object({
  revision: z.literal(1),
  id: z.uuid(),
  title: z.string().min(1).max(200),
  isDefaultTitle: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: z.array(messageSchema).max(10_000),
  selectedModel: modelReferenceSchema.nullable(),
  searchMode: z.enum(WEB_SEARCH_MODES),
  lastSearchEngine: z.enum(['google', 'bing']),
  reasoningEffort: z.enum(REASONING_EFFORTS),
})

export const conversationRenameSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
})

export const providerConnectionSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(PROVIDER_TYPES),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().max(2000).optional(),
  apiKey: z.string().max(10_000).optional(),
})

export const providerUsageFetchSchema = z.object({ providerId: idSchema })

export const providerAuthStatusSchema = z.object({
  providerId: idSchema,
  type: z.enum(PROVIDER_TYPES),
})

export const providerModelSchema = z.object({
  modelId: idSchema,
  name: z.string().min(1).max(500),
  group: z.string().min(1).max(200),
  ownedBy: z.string().max(200).optional(),
  capabilities: z.object({
    chat: z.boolean(),
    vision: z.boolean(),
    imageGeneration: z.boolean(),
    reasoning: z.boolean(),
  }),
  reasoningEfforts: z.array(z.enum(REASONING_EFFORTS)).optional(),
})

export const providerInputSchema = providerConnectionSchema.extend({
  catalogModels: z.array(providerModelSchema).max(25_000),
  selectedModelIds: z.array(idSchema).max(25_000),
})

export const providerEnabledSchema = z.object({ id: idSchema, enabled: z.boolean() })
export const favoriteSchema = z.object({ model: modelReferenceSchema, favorite: z.boolean() })

export const chatRequestSchema = z.object({
  requestId: z.uuid(),
  conversationId: z.uuid(),
  assistantMessageId: z.uuid(),
  model: modelReferenceSchema,
  messages: z.array(messageSchema).max(10_000),
  searchMode: z.enum(WEB_SEARCH_MODES),
  reasoningEffort: z.enum(REASONING_EFFORTS),
  imageGeneration: z.boolean(),
})

export const rendererLogSchema = z.object({
  level: z.enum(LOG_LEVELS),
  module: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  details: z.string().max(8_000).optional(),
})

export const fileSaveSchema = z.object({
  suggestedName: z.string().trim().min(1).max(200),
  content: z.string().max(10_000_000),
})
