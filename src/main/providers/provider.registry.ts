/** Manages multi-type provider persistence, catalog fetches, and chat model preferences. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  PROVIDER_TYPES,
  REASONING_EFFORTS,
  type ModelDescriptor,
  type ModelReference,
  type ProviderAuthStatus,
  type ProviderConnectionInput,
  type ProviderEditorData,
  type ProviderInput,
  type ProviderModelDefinition,
  type ProviderSnapshot,
  type ProviderSummary,
  type ProviderType,
  type ProviderUsageState,
  type ReasoningEffort,
} from '@shared/index'
import { z } from 'zod'
import { getModelSupportedReasoningEffortOptions, isReasoningModel } from '../reasoning/index'
import type LoggerService from '../logging/logger.service'
import { normalizeOpenAiBaseUrl } from './openai-compatible/openai-compatible.base-url'
import type { ProviderFamily } from './provider.family'

/** One persisted provider record with plaintext credentials and selected catalog entries. */
interface ProviderRecord {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  customHeaders: Record<string, string>
  builtin: boolean
  enabled: boolean
  apiKey: string
  models: ProviderModelDefinition[]
  selectedModelIds: string[]
}

/** The persisted providers document, holding order, credentials, and model preferences. */
interface ProviderFile {
  revision: 1
  providers: ProviderRecord[]
  favorites: ModelReference[]
  lastUsedModel: ModelReference | null
  quickModel: ModelReference | null
  titleGenerationEnabled: boolean
  /** Tracks the highest applied provider-document migration step for existing installs. */
  migrationVersion: number
}

/** One ordered provider-document migration applied once to documents from earlier releases. */
type ProviderFileMigration = (state: ProviderFile) => void

/** Ordered migration steps; indexes match the migrationVersion they upgrade to. */
const PROVIDER_FILE_MIGRATIONS: ProviderFileMigration[] = [
  /** Migration 1: gives the built-in OpenCode provider its User-Agent header once. */
  (state) => {
    const opencode = state.providers.find((provider) => provider.id === 'opencode')
    if (opencode && Object.keys(opencode.customHeaders).length === 0) {
      opencode.customHeaders = { 'User-Agent': 'opencode' }
    }
  },
]

/** One built-in preset shipped with the application. */
interface BuiltinProviderPreset {
  id: string
  name: string
  type: ProviderType
  baseUrl?: string
  defaultApiKey?: string
  enabledByDefault?: boolean
  customHeaders?: Record<string, string>
}

const BUILTIN_PROVIDERS: BuiltinProviderPreset[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    type: 'openai-compatible',
    baseUrl: 'https://opencode.ai/zen/v1',
    defaultApiKey: 'public',
    enabledByDefault: true,
    customHeaders: { 'User-Agent': 'opencode' },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
  },
  { id: 'chatgpt', name: 'ChatGPT', type: 'chatgpt' },
  { id: 'claude-web', name: 'Claude Web', type: 'claude-web' },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    type: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'inferx',
    name: 'Inferx',
    type: 'openai-compatible',
    baseUrl: 'https://model.inferx.net/endpoints/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:1234',
  },
  {
    id: 'ollama',
    name: 'Ollama Local',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:11434',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com',
  },
]

const referenceSchema = z.object({ providerId: z.string().min(1), modelId: z.string().min(1) })
const capabilitiesSchema = z.object({
  chat: z.boolean(),
  vision: z.boolean(),
  imageGeneration: z.boolean(),
  reasoning: z.boolean(),
})
const modelSchema = z.object({
  modelId: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  group: z.string().min(1).max(200),
  ownedBy: z.string().max(200).optional(),
  capabilities: capabilitiesSchema,
  reasoningEfforts: z.array(z.enum(REASONING_EFFORTS)).optional(),
})
const providerTypeSchema = z.enum(PROVIDER_TYPES)
const customHeadersSchema = z.record(
  z.string().trim().min(1).max(200),
  z.string().trim().min(1).max(10_000),
)
const connectionSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: providerTypeSchema,
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().max(2000).optional(),
    apiKey: z.string().max(10_000).optional(),
    customHeaders: customHeadersSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.type !== 'openai-compatible') return
    if (!value.baseUrl) {
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'API URL is required for OpenAI-compatible providers.',
      })
      return
    }
    const url = z.url().safeParse(value.baseUrl)
    if (!url.success || !/^https?:\/\//i.test(url.data)) {
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'API URL must be a valid HTTP(S) URL.',
      })
    }
  })
const providerInputSchema = connectionSchema.extend({
  catalogModels: z.array(modelSchema).max(25_000),
  selectedModelIds: z.array(z.string().min(1).max(500)).max(25_000),
})
const recordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: providerTypeSchema,
  baseUrl: z.string().max(2000),
  customHeaders: customHeadersSchema,
  builtin: z.boolean(),
  enabled: z.boolean(),
  apiKey: z.string().max(10_000),
  models: z.array(modelSchema).max(25_000),
  selectedModelIds: z.array(z.string().min(1).max(500)).max(25_000),
})
const fileSchema = z.object({
  revision: z.literal(1),
  providers: z.array(recordSchema),
  favorites: z.array(referenceSchema),
  lastUsedModel: referenceSchema.nullable(),
  quickModel: referenceSchema.nullable(),
  titleGenerationEnabled: z.boolean(),
  migrationVersion: z.number().int().nonnegative(),
})

/** Returns true when a parsed JSON value is a plain record of string values. */
const isStringRecord = (value: unknown): value is Record<string, string> =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        typeof key === 'string' &&
        key.trim().length > 0 &&
        key.length <= 200 &&
        typeof item === 'string' &&
        item.trim().length > 0 &&
        item.length <= 10_000,
    ),
  )

/** Supplies a stable family label to catalogs migrated before model groups were persisted. */
const inferModelGroup = (modelId: string, ownedBy?: string): string => {
  const pathOwner = modelId.includes('/') ? modelId.split('/')[0] : undefined
  if (pathOwner) return pathOwner
  if (ownedBy?.trim()) return ownedBy.trim()
  const id = modelId.toLowerCase()
  if (/claude/.test(id)) return 'Anthropic'
  if (/^(gpt|chatgpt|o\d|text-|dall-e)/.test(id)) return 'OpenAI'
  if (/gemini|gemma/.test(id)) return 'Google'
  if (/deepseek/.test(id)) return 'DeepSeek'
  if (/qwen|qwq/.test(id)) return 'Qwen'
  if (/llama/.test(id)) return 'Meta'
  if (/mistral|mixtral|codestral/.test(id)) return 'Mistral'
  return 'Other'
}

/** Returns model capabilities using conservative OpenAI-compatible naming conventions. */
const inferCapabilities = (
  modelId: string,
  provider?: { id?: string | undefined; name?: string | undefined; baseUrl?: string | undefined },
  modelName?: string | undefined,
): ModelDescriptor['capabilities'] => {
  const id = modelId.toLowerCase()
  const nonChat = /(embedding|embed-|rerank|moderation|whisper|tts|speech)/.test(id)
  return {
    chat: !nonChat && !/(dall-e|image-)/.test(id),
    vision: /(vision|vl|gpt-4o|gpt-4\.1|gemini|claude-3|claude-[4-9]|qwen.*vl)/.test(id),
    imageGeneration: /(dall-e|gpt-image|image-generation|flux)/.test(id),
    reasoning: isReasoningModel(
      { id: modelId, ...(modelName ? { name: modelName } : {}) },
      provider,
    ),
  }
}

/** Unions persisted reasoning choices with the static port so stale catalogs gain new levels. */
const mergeReasoningEfforts = (
  stored: unknown,
  inferred: ReasoningEffort[] | undefined,
): ReasoningEffort[] | undefined => {
  const combined: ReasoningEffort[] = []
  /** Adds one valid effort without duplicating earlier values. */
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return
    if (!REASONING_EFFORTS.includes(value as ReasoningEffort)) return
    if (!combined.includes(value as ReasoningEffort)) combined.push(value as ReasoningEffort)
  }
  if (Array.isArray(stored)) for (const value of stored) push(value)
  inferred?.forEach(push)
  if (combined.length === 0) return undefined
  if (!combined.includes('default')) return combined
  return ['default', ...combined.filter((value) => value !== 'default')]
}

/** Normalizes provider documents with model groups and explicit model selections. */
const normalizeProviderFile = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const value = input as Record<string, unknown>
  const providers = Array.isArray(value.providers)
    ? value.providers
        .filter((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return true
          const storedType = (item as Record<string, unknown>).type
          // Drops providers from removed families (e.g. the old Codex type) on load.
          return (
            typeof storedType !== 'string' ||
            (PROVIDER_TYPES as readonly string[]).includes(storedType)
          )
        })
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return item
          const provider = item as Record<string, unknown>
          const models = Array.isArray(provider.models)
            ? provider.models.map((itemModel) => {
                if (!itemModel || typeof itemModel !== 'object' || Array.isArray(itemModel))
                  return itemModel
                const model = itemModel as Record<string, unknown>
                const modelId = typeof model.modelId === 'string' ? model.modelId : ''
                const ownedBy = typeof model.ownedBy === 'string' ? model.ownedBy : undefined
                const providerLike = {
                  id: typeof provider.id === 'string' ? provider.id : undefined,
                  name: typeof provider.name === 'string' ? provider.name : undefined,
                  baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : undefined,
                }
                const modelName = typeof model.name === 'string' ? model.name : undefined
                const inferredCapabilities = inferCapabilities(modelId, providerLike, modelName)
                const storedCapabilities =
                  model.capabilities &&
                  typeof model.capabilities === 'object' &&
                  !Array.isArray(model.capabilities)
                    ? (model.capabilities as Record<string, unknown>)
                    : {}
                const capabilities = {
                  chat:
                    typeof storedCapabilities.chat === 'boolean'
                      ? storedCapabilities.chat
                      : inferredCapabilities.chat,
                  vision:
                    typeof storedCapabilities.vision === 'boolean'
                      ? storedCapabilities.vision
                      : inferredCapabilities.vision,
                  imageGeneration:
                    typeof storedCapabilities.imageGeneration === 'boolean'
                      ? storedCapabilities.imageGeneration
                      : inferredCapabilities.imageGeneration,
                  reasoning:
                    storedCapabilities.reasoning === true || inferredCapabilities.reasoning,
                }
                return {
                  ...model,
                  capabilities,
                  group:
                    typeof model.group === 'string' && model.group.trim()
                      ? model.group
                      : inferModelGroup(modelId, ownedBy),
                  reasoningEfforts: mergeReasoningEfforts(
                    model.reasoningEfforts,
                    getModelSupportedReasoningEffortOptions(
                      { id: modelId, name: modelName },
                      providerLike,
                    ),
                  ),
                }
              })
            : []
          const inferredIds = models.flatMap((model) =>
            model &&
            typeof model === 'object' &&
            !Array.isArray(model) &&
            typeof (model as Record<string, unknown>).modelId === 'string'
              ? [(model as Record<string, unknown>).modelId as string]
              : [],
          )
          const selectedModelIds = Array.isArray(provider.selectedModelIds)
            ? provider.selectedModelIds
            : inferredIds
          const storedType = provider.type
          return {
            id: provider.id,
            name: provider.name,
            type:
              typeof storedType === 'string' &&
              (PROVIDER_TYPES as readonly string[]).includes(storedType)
                ? (storedType as ProviderType)
                : 'openai-compatible',
            baseUrl: provider.baseUrl ?? '',
            customHeaders: isStringRecord(provider.customHeaders)
              ? (provider.customHeaders as Record<string, string>)
              : {},
            builtin: provider.builtin,
            enabled: provider.enabled,
            apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
            models: models.filter(
              (model) =>
                model &&
                typeof model === 'object' &&
                !Array.isArray(model) &&
                selectedModelIds.includes((model as Record<string, unknown>).modelId as string),
            ),
            selectedModelIds,
          }
        })
    : value.providers
  return {
    revision: 1,
    providers,
    favorites: value.favorites ?? [],
    lastUsedModel: value.lastUsedModel ?? value.defaultModel ?? null,
    quickModel: value.quickModel ?? null,
    titleGenerationEnabled: value.titleGenerationEnabled ?? true,
    migrationVersion:
      typeof value.migrationVersion === 'number' &&
      Number.isInteger(value.migrationVersion) &&
      value.migrationVersion >= 0
        ? value.migrationVersion
        : 0,
  }
}

/** Creates a status-only API error without exposing response bodies or request credentials. */
const responseError = (response: Response): Error =>
  new Error(`Provider returned ${response.status}.`)

/** Derives the one-time clean-install API-key variable from a provider display name. */
const providerApiKeyEnvironmentVariable = (providerName: string): string => {
  const normalizedName = providerName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${normalizedName}_API_KEY`
}

/** Owns provider persistence while exposing credentials only through explicit edit requests. */
export class ProviderRegistry {
  private readonly filePath: string
  private state: ProviderFile | null = null
  private readonly families = new Map<ProviderType, ProviderFamily>()

  /** Creates a provider registry rooted in the private AI Chat data directory. */
  public constructor(
    rootPath: string,
    private readonly logger: LoggerService,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.filePath = join(rootPath, 'providers.json')
  }

  /** Registers one provider-family adapter used for catalogs, sign-in, and usage. */
  public registerFamily(family: ProviderFamily): void {
    this.families.set(family.type, family)
  }

  /** Loads provider state and prepares environment credentials and OpenCode on a clean install. */
  public async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    let stored: ProviderFile | null = null
    try {
      const parsed = fileSchema.safeParse(
        normalizeProviderFile(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown),
      )
      if (parsed.success) stored = parsed.data
      else this.logger.warn('ProviderRegistry', 'Provider file validation failed.', parsed.error)
    } catch {
      stored = null
    }
    const isCleanInstall = stored === null
    const current = stored ?? {
      revision: 1 as const,
      providers: [],
      favorites: [],
      lastUsedModel: null,
      quickModel: null,
      titleGenerationEnabled: true,
      migrationVersion: 0,
    }
    for (const preset of BUILTIN_PROVIDERS) {
      if (!current.providers.some((provider) => provider.id === preset.id)) {
        current.providers.push({
          id: preset.id,
          name: preset.name,
          type: preset.type,
          baseUrl: preset.baseUrl ?? '',
          customHeaders: preset.customHeaders ?? {},
          builtin: true,
          enabled: preset.enabledByDefault ?? false,
          apiKey: preset.defaultApiKey ?? '',
          models: [],
          selectedModelIds: [],
        })
      }
    }
    const ollama = current.providers.find((provider) => provider.id === 'ollama')
    if (ollama?.builtin && ollama.name === 'Ollama') ollama.name = 'Ollama Local'
    this.applyMigrations(current)
    if (isCleanInstall) this.importEnvironmentApiKeys(current.providers)
    this.state = current
    if (isCleanInstall) await this.initializeOpenCodeDefaults()
    this.removeInvalidPreferences()
    await this.persist()
  }

  /** Applies every pending provider-document migration in order and records the new version. */
  private applyMigrations(state: ProviderFile): void {
    const from = state.migrationVersion
    while (state.migrationVersion < PROVIDER_FILE_MIGRATIONS.length) {
      const migration = PROVIDER_FILE_MIGRATIONS[state.migrationVersion]
      if (!migration) break
      migration(state)
      state.migrationVersion += 1
    }
    if (state.migrationVersion > from) {
      this.logger.info('ProviderRegistry', 'Applied provider document migrations.', {
        from,
        to: state.migrationVersion,
      })
    }
  }

  /** Imports matching OpenAI-compatible credentials once and enables each matched preset. */
  private importEnvironmentApiKeys(providers: ProviderRecord[]): void {
    const importedProviderIds: string[] = []
    for (const provider of providers) {
      if (provider.type !== 'openai-compatible') continue
      const variableName = providerApiKeyEnvironmentVariable(provider.name)
      const apiKey = this.environment[variableName]?.trim()
      if (!apiKey) continue
      provider.apiKey = apiKey
      provider.enabled = true
      importedProviderIds.push(provider.id)
    }
    if (importedProviderIds.length > 0) {
      this.logger.info('ProviderRegistry', 'Imported clean-install provider API keys.', {
        providerIds: importedProviderIds,
      })
    }
  }

  /** Returns ordered provider metadata and only explicitly selected models for chat selectors. */
  public snapshot(): ProviderSnapshot {
    const state = this.getState()
    const favoriteKeys = new Set(state.favorites.map((item) => this.referenceKey(item)))
    const providers: ProviderSummary[] = state.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      ...(Object.keys(provider.customHeaders).length > 0
        ? { customHeaders: provider.customHeaders }
        : {}),
      builtin: provider.builtin,
      enabled: provider.enabled,
      hasApiKey: provider.apiKey.length > 0,
      modelCount: provider.selectedModelIds.filter((id) =>
        provider.models.some((model) => model.modelId === id),
      ).length,
    }))
    /** Qualifies persisted definitions for renderer use and optionally limits them to selections. */
    const describeModels = (records: ProviderRecord[], selectedOnly: boolean): ModelDescriptor[] =>
      records.flatMap((provider) => {
        const selected = new Set(provider.selectedModelIds)
        return provider.models
          .filter((model) => !selectedOnly || selected.has(model.modelId))
          .map((model) => ({
            ...model,
            providerId: provider.id,
            favorite: favoriteKeys.has(
              this.referenceKey({ providerId: provider.id, modelId: model.modelId }),
            ),
          }))
      })
    return {
      providers,
      models: describeModels(
        state.providers.filter((provider) => provider.enabled),
        true,
      ),
      catalogModels: describeModels(state.providers, false),
      favorites: state.favorites,
      lastUsedModel: state.lastUsedModel,
      quickModel: state.quickModel,
      titleGenerationEnabled: state.titleGenerationEnabled,
    }
  }

  /** Returns one provider's plaintext key and saved model selection for its explicit edit dialog. */
  public getEditorData(id: string): ProviderEditorData {
    const provider = this.requireProvider(id)
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      ...(Object.keys(provider.customHeaders).length > 0
        ? { customHeaders: provider.customHeaders }
        : {}),
      catalogModels: provider.models,
      selectedModelIds: provider.selectedModelIds,
    }
  }

  /** Resolves the provider type for one saved provider identifier. */
  public getProviderType(id: string): ProviderType {
    return this.requireProvider(id).type
  }

  /** Fetches a catalog with unsaved form values, delegating login families to the auth service. */
  public async fetchModelCatalog(
    input: ProviderConnectionInput,
  ): Promise<ProviderModelDefinition[]> {
    const parsed = connectionSchema.parse(input)
    const family = this.familyFor(parsed.type)
    if (family) return family.fetchCatalog(parsed)
    return this.fetchModels(parsed)
  }

  /** Saves fields and selected catalog entries without testing the URL or fetching models. */
  public async save(input: ProviderInput): Promise<ProviderSnapshot> {
    const parsed = providerInputSchema.parse(input)
    const state = this.getState()
    const existing = parsed.id
      ? state.providers.find((provider) => provider.id === parsed.id)
      : undefined
    if (parsed.id && !existing) throw new Error('Provider was not found.')
    const uniqueModels = new Map(parsed.catalogModels.map((model) => [model.modelId, model]))
    const selectedModelIds = [...new Set(parsed.selectedModelIds)].filter((id) =>
      uniqueModels.has(id),
    )
    const candidate: ProviderRecord = {
      id: existing?.id ?? randomUUID(),
      name: parsed.name,
      type: parsed.type,
      baseUrl:
        parsed.type === 'openai-compatible' ? (parsed.baseUrl ?? '').replace(/\/+$/, '') : '',
      customHeaders: parsed.type === 'openai-compatible' ? (parsed.customHeaders ?? {}) : {},
      builtin: existing?.builtin ?? false,
      enabled: existing?.enabled ?? true,
      apiKey: parsed.type === 'openai-compatible' ? (parsed.apiKey ?? '') : '',
      models: [...uniqueModels.values()].filter((model) =>
        selectedModelIds.includes(model.modelId),
      ),
      selectedModelIds,
    }
    const index = state.providers.findIndex((provider) => provider.id === candidate.id)
    if (index === -1) state.providers.push(candidate)
    else state.providers[index] = candidate
    this.removeInvalidPreferences()
    this.assignInitialDefaults(candidate)
    await this.persist()
    return this.snapshot()
  }

  /** Enables or disables a provider without changing or fetching its saved model catalog. */
  public async setEnabled(id: string, enabled: boolean): Promise<ProviderSnapshot> {
    const provider = this.requireProvider(id)
    provider.enabled = enabled
    this.removeInvalidPreferences()
    this.assignInitialDefaults(provider)
    await this.persist()
    return this.snapshot()
  }

  /** Persists an exact drag-and-drop order after validating every provider appears once. */
  public async reorder(providerIds: string[]): Promise<ProviderSnapshot> {
    const state = this.getState()
    const unique = new Set(providerIds)
    if (unique.size !== state.providers.length || providerIds.length !== state.providers.length) {
      throw new Error('Provider order is incomplete.')
    }
    const byId = new Map(state.providers.map((provider) => [provider.id, provider]))
    const reordered = providerIds.map((id) => byId.get(id))
    if (reordered.some((provider) => provider === undefined)) {
      throw new Error('Provider order contains an unknown provider.')
    }
    state.providers = reordered as ProviderRecord[]
    await this.persist()
    return this.snapshot()
  }

  /** Removes only user-created provider entries while retaining built-in rows in the order. */
  public async delete(id: string): Promise<ProviderSnapshot> {
    const state = this.getState()
    const provider = this.requireProvider(id)
    if (provider.builtin) throw new Error('Built-in providers cannot be deleted.')
    state.providers = state.providers.filter((item) => item.id !== id)
    state.favorites = state.favorites.filter((item) => item.providerId !== id)
    this.removeInvalidPreferences()
    await this.persist()
    return this.snapshot()
  }

  /** Signs the login family of one saved provider in through its native flow. */
  public async authenticate(id: string): Promise<boolean> {
    const provider = this.requireProvider(id)
    const family = this.familyFor(provider.type)
    if (!family?.startSignIn) throw new Error('This provider type does not require sign-in.')
    await family.startSignIn(provider.id)
    return true
  }

  /** Signs the login family of one saved provider out, clearing its persisted credentials. */
  public async logout(id: string): Promise<boolean> {
    const provider = this.requireProvider(id)
    const family = this.familyFor(provider.type)
    if (!family?.signOut) throw new Error('This provider type does not require sign-in.')
    await family.signOut(provider.id)
    return true
  }

  /** Describes the authentication state of one saved provider without exposing secrets. */
  public async authStatus(id: string): Promise<ProviderAuthStatus> {
    const provider = this.requireProvider(id)
    const family = this.familyFor(provider.type)
    if (!family?.authStatus) {
      return {
        providerId: provider.id,
        signedIn: false,
        signingIn: false,
        accountEmail: '',
        plan: '',
        hasRefreshToken: false,
      }
    }
    return family.authStatus(provider.id)
  }

  /** Fetches the usage overview for one login-family provider, or empty data when unsupported. */
  public async fetchUsage(id: string): Promise<ProviderUsageState> {
    const provider = this.requireProvider(id)
    const family = this.familyFor(provider.type)
    if (family?.fetchUsage) return family.fetchUsage(provider.id)
    return { plan: '', windows: [], fetchedAt: Date.now() }
  }

  /** Adds or removes one selected model from the favorites shown at the top of selectors. */
  public async setFavorite(model: ModelReference, favorite: boolean): Promise<ProviderSnapshot> {
    referenceSchema.parse(model)
    this.requireModel(model)
    const state = this.getState()
    const key = this.referenceKey(model)
    state.favorites = state.favorites.filter((item) => this.referenceKey(item) !== key)
    if (favorite) state.favorites.unshift(model)
    await this.persist()
    return this.snapshot()
  }

  /** Stores the selected model explicitly chosen most recently in the chat workspace. */
  public async setLastUsedModel(model: ModelReference): Promise<ProviderSnapshot> {
    this.requireChatModel(model)
    this.getState().lastUsedModel = model
    await this.persist()
    return this.snapshot()
  }

  /** Stores the optional selected model used for titles and search query planning. */
  public async setQuickModel(model: ModelReference | null): Promise<ProviderSnapshot> {
    if (model) this.requireChatModel(model)
    this.getState().quickModel = model
    await this.persist()
    return this.snapshot()
  }

  /** Stores whether the Quick Model should generate titles for new chats. */
  public async setTitleGenerationEnabled(enabled: boolean): Promise<ProviderSnapshot> {
    this.getState().titleGenerationEnabled = enabled
    await this.persist()
    return this.snapshot()
  }

  /** Resolves one selected model, provider metadata, plaintext key, and model definition. */
  public resolve(model: ModelReference): {
    provider: ProviderSummary
    apiKey: string
    modelDefinition: ProviderModelDefinition
  } {
    this.requireModel(model)
    const provider = this.requireProvider(model.providerId)
    if (!provider.enabled) throw new Error('The selected provider is disabled.')
    const modelDefinition = provider.models.find((item) => item.modelId === model.modelId)
    if (!modelDefinition) throw new Error('Model was not found.')
    return {
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        ...(Object.keys(provider.customHeaders).length > 0
          ? { customHeaders: provider.customHeaders }
          : {}),
        builtin: provider.builtin,
        enabled: provider.enabled,
        hasApiKey: provider.apiKey.length > 0,
        modelCount: provider.selectedModelIds.filter((id) =>
          provider.models.some((model) => model.modelId === id),
        ).length,
      },
      apiKey: provider.apiKey,
      modelDefinition,
    }
  }

  /** Returns the registered family for one provider type, or undefined for plain API providers. */
  private familyFor(type: ProviderType): ProviderFamily | undefined {
    return this.families.get(type)
  }

  /** Requests, validates, de-duplicates, groups, and classifies one provider model list. */
  private async fetchModels(provider: ProviderConnectionInput): Promise<ProviderModelDefinition[]> {
    if (!provider.baseUrl) throw new Error('API URL is required for OpenAI-compatible providers.')
    const baseUrl = normalizeOpenAiBaseUrl(provider.baseUrl)
    const headers: Record<string, string> = {
      ...(provider.customHeaders ?? {}),
    }
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`
      headers['x-api-key'] = provider.apiKey
    }
    this.logger.info('ProviderRegistry', `Fetching models from ${baseUrl}/models`)
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      this.logger.warn(
        'ProviderRegistry',
        `Model fetch failed with ${response.status}: ${body.slice(0, 500)}`,
      )
      throw responseError(response)
    }
    const payload = (await response.json()) as unknown
    const records =
      payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : Array.isArray(payload)
          ? payload
          : []
    const unique = new Map<string, ProviderModelDefinition>()
    let discoveredModel = false
    for (const item of records) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      const modelId =
        typeof raw.id === 'string' ? raw.id : typeof raw.name === 'string' ? raw.name : ''
      if (!modelId) continue
      discoveredModel = true
      const name = typeof raw.name === 'string' ? raw.name : modelId
      const ownedBy = typeof raw.owned_by === 'string' ? raw.owned_by : undefined
      const capabilities = inferCapabilities(
        modelId,
        { id: provider.id, name: provider.name, baseUrl: provider.baseUrl },
        name,
      )
      const reasoningEfforts = this.inferReasoningEfforts(raw, modelId, {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
      })
      unique.set(modelId, {
        modelId,
        name,
        group:
          typeof raw.group === 'string' && raw.group.trim()
            ? raw.group.trim()
            : inferModelGroup(modelId, ownedBy),
        ...(ownedBy ? { ownedBy } : {}),
        capabilities,
        ...(reasoningEfforts ? { reasoningEfforts } : {}),
      })
    }
    if (!discoveredModel) throw new Error('Provider returned no models.')
    return [...unique.values()].sort(
      (left, right) => left.group.localeCompare(right.group) || left.name.localeCompare(right.name),
    )
  }

  /** Builds reasoning choices from explicit metadata and known model families. */
  private inferReasoningEfforts(
    raw: Record<string, unknown>,
    modelId: string,
    provider: { id?: string | undefined; name?: string | undefined; baseUrl?: string | undefined },
  ): ReasoningEffort[] | undefined {
    const source = raw.reasoning_efforts ?? raw.reasoningEfforts
    if (Array.isArray(source)) {
      const valid = [
        ...new Set(
          source.flatMap((value): ReasoningEffort[] => {
            if (typeof value !== 'string') return []
            const normalized =
              value === 'none'
                ? 'off'
                : value === 'max' || value === 'extra_high' || value === 'extra-high'
                  ? 'xhigh'
                  : value
            return REASONING_EFFORTS.includes(normalized as ReasoningEffort)
              ? [normalized as ReasoningEffort]
              : []
          }),
        ),
      ]
      if (valid.length > 0) {
        return ['default', ...valid.filter((value) => value !== 'default')]
      }
    }
    return getModelSupportedReasoningEffortOptions(
      { id: modelId, name: typeof raw.name === 'string' ? raw.name : undefined },
      provider,
    )
  }

  /** Fetches the first-install OpenCode catalog and selects the preferred free chat model. */
  private async initializeOpenCodeDefaults(): Promise<void> {
    const provider = this.requireProvider('opencode')
    try {
      const models = await this.fetchModels({
        id: provider.id,
        type: provider.type,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        ...(Object.keys(provider.customHeaders).length > 0
          ? { customHeaders: provider.customHeaders }
          : {}),
      })
      /** Returns searchable catalog text for case-insensitive default-model matching. */
      const searchableText = (model: ProviderModelDefinition): string =>
        `${model.modelId} ${model.name} ${model.group}`.toLowerCase()
      const freeChatModels = models.filter(
        (model) => model.capabilities.chat && searchableText(model).includes('free'),
      )
      const selected =
        freeChatModels.find((model) => searchableText(model).includes('muse')) ?? freeChatModels[0]
      if (!selected) {
        this.logger.warn(
          'ProviderRegistry',
          'Initial OpenCode catalog did not contain a free chat model.',
        )
        return
      }
      provider.models = [selected]
      provider.selectedModelIds = [selected.modelId]
      this.assignInitialDefaults(provider)
    } catch (error) {
      this.logger.warn('ProviderRegistry', 'Initial OpenCode model fetch failed.', error)
    }
  }

  /** Initializes last-used and Quick Model preferences from the first selected chat model. */
  private assignInitialDefaults(provider: ProviderRecord): void {
    if (!provider.enabled) return
    const selected = new Set(provider.selectedModelIds)
    const first = provider.models.find(
      (model) => selected.has(model.modelId) && model.capabilities.chat,
    )
    if (!first) return
    const state = this.getState()
    const reference = { providerId: provider.id, modelId: first.modelId }
    state.lastUsedModel ??= reference
    state.quickModel ??= reference
  }

  /** Removes favorites and model preferences that no longer point to enabled selected models. */
  private removeInvalidPreferences(): void {
    const state = this.getState()
    /** Checks whether a model reference still targets an enabled selected model. */
    const valid = (reference: ModelReference): boolean => {
      const provider = state.providers.find((item) => item.id === reference.providerId)
      return Boolean(
        provider?.enabled &&
        provider.selectedModelIds.includes(reference.modelId) &&
        provider.models.some((model) => model.modelId === reference.modelId),
      )
    }
    state.favorites = state.favorites.filter(valid)
    if (state.lastUsedModel && !valid(state.lastUsedModel)) state.lastUsedModel = null
    if (state.quickModel && !valid(state.quickModel)) state.quickModel = null
  }

  /** Resolves one provider record or rejects an unknown identifier. */
  private requireProvider(id: string): ProviderRecord {
    const provider = this.getState().providers.find((item) => item.id === id)
    if (!provider) throw new Error('Provider was not found.')
    return provider
  }

  /** Resolves one explicitly selected model or rejects an unavailable reference. */
  private requireModel(reference: ModelReference): ProviderModelDefinition {
    const provider = this.requireProvider(reference.providerId)
    const model = provider.models.find(
      (item) =>
        item.modelId === reference.modelId && provider.selectedModelIds.includes(item.modelId),
    )
    if (!model) throw new Error('Model was not found.')
    return model
  }

  /** Ensures one selected model is eligible for regular chat completion. */
  private requireChatModel(reference: ModelReference): void {
    if (!this.requireModel(reference).capabilities.chat)
      throw new Error('This is not a chat model.')
  }

  /** Returns initialized state and prevents access before startup initialization. */
  private getState(): ProviderFile {
    if (!this.state) throw new Error('Provider registry has not been initialized.')
    return this.state
  }

  /** Produces an unambiguous internal key for one provider/model pair. */
  private referenceKey(reference: ModelReference): string {
    return `${reference.providerId}\u0000${reference.modelId}`
  }

  /** Atomically writes provider order, plaintext API keys, model selections, and preferences to disk. */
  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(this.getState(), null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }
}
