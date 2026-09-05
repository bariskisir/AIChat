/**
 * Verifies provider registry persistence, built-in presets, plaintext credentials,
 * model selection, catalog routing, and chat-model preferences.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelReference, ProviderModelDefinition } from '@shared/index'
import type LoggerService from '@main/logging/logger.service'
import type { ProviderFamily } from '@main/providers/provider.family'
import { ProviderRegistry } from '@main/providers/provider.registry'

let rootPath = ''
let registry: ProviderRegistry

/** Creates the logger surface needed by the provider registry. */
const createLogger = (): LoggerService =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as LoggerService

/** Creates an isolated initialized registry under one temporary root directory. */
const createRegistry = async (
  root = rootPath,
  environment: NodeJS.ProcessEnv = {},
): Promise<ProviderRegistry> => {
  const service = new ProviderRegistry(root, createLogger(), environment)
  await service.initialize()
  return service
}

/** Returns a plain chat-capable catalog model for one provider model identifier. */
const catalogModel = (modelId: string, name = modelId): ProviderModelDefinition => ({
  modelId,
  name,
  group: 'Test',
  capabilities: { chat: true, vision: false, imageGeneration: false, reasoning: false },
})

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'ai-chat-provider-test-'))
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'meta/llama-free', name: 'Llama Free' },
              { id: 'muse-spark-1.2-contributor-free', name: 'Muse Spark 1.2 Contributor Free' },
              { id: 'deepseek/deepseek-v3-free', name: 'DeepSeek V3 Free' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ),
  )
  registry = await createRegistry()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(rootPath, { recursive: true, force: true })
})

describe('ProviderRegistry', () => {
  it('configures OpenCode with the first free chat model on a clean install', async () => {
    const snapshot = registry.snapshot()
    const opencode = snapshot.providers.find((provider) => provider.id === 'opencode')

    expect(fetch).toHaveBeenCalledWith(
      'https://opencode.ai/zen/v1/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer public',
          'User-Agent': 'opencode',
          'x-api-key': 'public',
        },
      }),
    )
    expect(opencode).toMatchObject({ enabled: true, hasApiKey: true, modelCount: 1 })
    expect(registry.getEditorData('opencode')).toMatchObject({
      apiKey: 'public',
      selectedModelIds: ['deepseek/deepseek-v3-free'],
    })
    expect(snapshot.lastUsedModel).toEqual({
      providerId: 'opencode',
      modelId: 'deepseek/deepseek-v3-free',
    })
    expect(snapshot.quickModel).toEqual(snapshot.lastUsedModel)
  })

  it('selects the first free OpenCode chat model from a replacement catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'meta/llama-free', name: 'Llama Free' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    const fallback = await createRegistry(join(rootPath, 'fallback'))

    expect(fallback.snapshot().quickModel).toEqual({
      providerId: 'opencode',
      modelId: 'meta/llama-free',
    })
  })

  it('preserves a user-edited OpenCode key and model across later launches', async () => {
    await registry.save({
      id: 'opencode',
      type: 'openai-compatible',
      name: 'OpenCode',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: 'personal-key',
      catalogModels: [catalogModel('custom/model', 'Custom Model')],
      selectedModelIds: ['custom/model'],
    })
    vi.mocked(fetch).mockClear()

    const reloaded = await createRegistry()

    expect(fetch).not.toHaveBeenCalled()
    expect(reloaded.getEditorData('opencode')).toMatchObject({
      apiKey: 'personal-key',
      selectedModelIds: ['custom/model'],
    })
    expect(reloaded.snapshot().quickModel).toEqual({
      providerId: 'opencode',
      modelId: 'custom/model',
    })
  })

  it('applies the OpenCode User-Agent header once to existing installs that lack it', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        providers: [
          {
            id: 'opencode',
            name: 'OpenCode',
            type: 'openai-compatible',
            baseUrl: 'https://opencode.ai/zen/v1',
            builtin: true,
            enabled: true,
            apiKey: 'public',
            models: [],
            selectedModelIds: [],
          },
        ],
        favorites: [],
        lastUsedModel: null,
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )
    vi.mocked(fetch).mockClear()

    const upgraded = await createRegistry()
    expect(upgraded.getEditorData('opencode').customHeaders).toEqual({ 'User-Agent': 'opencode' })

    const persisted = JSON.parse(await readFile(join(rootPath, 'providers.json'), 'utf8'))
    expect(persisted.migrationVersion).toBe(4)

    await upgraded.save({
      id: 'opencode',
      type: 'openai-compatible',
      name: 'OpenCode',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: 'public',
      catalogModels: [],
      selectedModelIds: [],
    })

    const relaunched = await createRegistry()
    expect(relaunched.getEditorData('opencode').customHeaders).toBeUndefined()
  })

  it('refreshes server reasoning levels once when upgrading stored catalogs', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        migrationVersion: 3,
        providers: [
          {
            id: 'openrouter',
            name: 'OpenRouter',
            type: 'openai-compatible',
            baseUrl: 'https://openrouter.ai/api/v1',
            batchUrl: 'https://openrouter.ai/api/beta/batches',
            batchPollIntervalSeconds: 30,
            batchModelRegex: 'batch',
            customHeaders: {},
            builtin: true,
            enabled: true,
            apiKey: 'router-key',
            models: [
              {
                modelId: 'openai/gpt-6-astra',
                name: 'GPT-6 Astra',
                group: 'openai',
                capabilities: {
                  chat: true,
                  vision: false,
                  imageGeneration: false,
                  reasoning: true,
                },
                reasoningEfforts: ['default', 'minimal'],
              },
              {
                modelId: 'openai/gpt-4o',
                name: 'GPT-4o',
                group: 'openai',
                capabilities: {
                  chat: true,
                  vision: false,
                  imageGeneration: false,
                  reasoning: false,
                },
              },
            ],
            selectedModelIds: ['openai/gpt-6-astra', 'openai/gpt-4o'],
          },
        ],
        favorites: [],
        lastUsedModel: null,
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'openai/gpt-6-astra',
                  name: 'GPT-6 Astra',
                  reasoning: { supported_efforts: ['low', 'medium', 'max'] },
                },
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
                { id: 'openai/brand-new-model', name: 'Brand New' },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )

    const upgraded = await createRegistry()
    const editor = upgraded.getEditorData('openrouter')
    const astra = editor.catalogModels.find((model) => model.modelId === 'openai/gpt-6-astra')
    expect(astra?.reasoningEfforts).toEqual(['default', 'low', 'medium', 'max'])
    expect(astra?.capabilities.reasoning).toBe(true)
    // Selections and membership are untouched: no model added, none removed.
    expect(editor.selectedModelIds).toEqual(['openai/gpt-6-astra', 'openai/gpt-4o'])
    expect(editor.catalogModels.map((model) => model.modelId)).toEqual([
      'openai/gpt-6-astra',
      'openai/gpt-4o',
    ])
    const persisted = JSON.parse(await readFile(join(rootPath, 'providers.json'), 'utf8'))
    expect(persisted.migrationVersion).toBe(4)

    // A second launch does not refetch: the stored server levels are kept as-is.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('must not refetch')
      }),
    )
    const relaunched = await createRegistry()
    expect(
      relaunched
        .getEditorData('openrouter')
        .catalogModels.find((model) => model.modelId === 'openai/gpt-6-astra')?.reasoningEfforts,
    ).toEqual(['default', 'low', 'medium', 'max'])
  })

  it('keeps the fixed fallback list when the upgrade refresh cannot reach the server', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        migrationVersion: 3,
        providers: [
          {
            id: 'router',
            name: 'Router',
            type: 'openai-compatible',
            baseUrl: 'https://router.example/v1',
            batchUrl: '',
            batchPollIntervalSeconds: 30,
            batchModelRegex: 'batch',
            customHeaders: {},
            builtin: false,
            enabled: true,
            apiKey: '',
            models: [
              {
                modelId: 'vendor/model',
                name: 'Model',
                group: 'vendor',
                capabilities: {
                  chat: true,
                  vision: false,
                  imageGeneration: false,
                  reasoning: true,
                },
                reasoningEfforts: ['default', 'minimal'],
              },
            ],
            selectedModelIds: ['vendor/model'],
          },
        ],
        favorites: [],
        lastUsedModel: null,
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )

    const upgraded = await createRegistry()
    const model = upgraded
      .getEditorData('router')
      .catalogModels.find((item) => item.modelId === 'vendor/model')
    expect(model?.reasoningEfforts).toBeUndefined()
    expect(model?.capabilities.reasoning).toBe(false)
  })

  it('prunes unlisted ChatGPT models and refreshes levels when upgrading', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        migrationVersion: 3,
        providers: [
          {
            id: 'chatgpt',
            name: 'ChatGPT',
            type: 'chatgpt',
            baseUrl: '',
            batchUrl: '',
            batchPollIntervalSeconds: 30,
            batchModelRegex: 'batch',
            customHeaders: {},
            builtin: true,
            enabled: true,
            apiKey: '',
            models: [
              {
                modelId: 'gpt-reserve',
                name: 'GPT-Reserve',
                group: 'Codex',
                capabilities: {
                  chat: true,
                  vision: false,
                  imageGeneration: false,
                  reasoning: true,
                },
                reasoningEfforts: ['default', 'low', 'medium', 'xhigh'],
              },
              {
                modelId: 'gpt-5.6-terra',
                name: 'GPT-5.6-Terra',
                group: 'Codex',
                capabilities: {
                  chat: true,
                  vision: false,
                  imageGeneration: false,
                  reasoning: true,
                },
                reasoningEfforts: ['default', 'low', 'medium', 'xhigh'],
              },
            ],
            selectedModelIds: ['gpt-reserve', 'gpt-5.6-terra'],
          },
        ],
        favorites: [{ providerId: 'chatgpt', modelId: 'gpt-reserve' }],
        lastUsedModel: { providerId: 'chatgpt', modelId: 'gpt-reserve' },
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )
    const service = new ProviderRegistry(rootPath, createLogger(), {})
    service.registerFamily({
      type: 'chatgpt',
      fetchCatalog: async () => [
        {
          modelId: 'gpt-5.6-terra',
          name: 'GPT-5.6-Terra',
          group: 'Codex',
          capabilities: { chat: true, vision: false, imageGeneration: false, reasoning: true },
          reasoningEfforts: ['default', 'low', 'medium', 'xhigh', 'max', 'ultra'],
        },
      ],
    })
    await service.initialize()

    const editor = service.getEditorData('chatgpt')
    expect(editor.catalogModels.map((model) => model.modelId)).toEqual(['gpt-5.6-terra'])
    expect(editor.selectedModelIds).toEqual(['gpt-5.6-terra'])
    expect(
      editor.catalogModels.find((model) => model.modelId === 'gpt-5.6-terra')?.reasoningEfforts,
    ).toEqual(['default', 'low', 'medium', 'xhigh', 'max', 'ultra'])
    expect(service.snapshot().favorites).toEqual([])
    expect(service.snapshot().lastUsedModel).toBeNull()
  })

  it('skips the upgrade refresh for providers without stored models', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        migrationVersion: 3,
        providers: [
          {
            id: 'opencode',
            name: 'OpenCode',
            type: 'openai-compatible',
            baseUrl: 'https://opencode.ai/zen/v1',
            batchUrl: '',
            batchPollIntervalSeconds: 30,
            batchModelRegex: 'batch',
            customHeaders: {},
            builtin: true,
            enabled: true,
            apiKey: 'public',
            models: [],
            selectedModelIds: [],
          },
        ],
        favorites: [],
        lastUsedModel: null,
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )
    vi.mocked(fetch).mockClear()

    await createRegistry()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('prunes unlisted Claude Web models and refreshes levels when upgrading', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        migrationVersion: 3,
        providers: [
          {
            id: 'claude-web',
            name: 'Claude Web',
            type: 'claude-web',
            baseUrl: '',
            batchUrl: '',
            batchPollIntervalSeconds: 30,
            batchModelRegex: 'batch',
            customHeaders: {},
            builtin: true,
            enabled: true,
            apiKey: '',
            models: [
              {
                modelId: 'claude-opus-3',
                name: 'Opus 3',
                group: 'Claude Web',
                capabilities: {
                  chat: true,
                  vision: true,
                  imageGeneration: false,
                  reasoning: false,
                },
              },
              {
                modelId: 'claude-sonnet-5',
                name: 'Sonnet 5',
                group: 'Claude Web',
                capabilities: { chat: true, vision: true, imageGeneration: false, reasoning: true },
                reasoningEfforts: ['default', 'low', 'medium', 'high'],
              },
            ],
            selectedModelIds: ['claude-opus-3', 'claude-sonnet-5'],
          },
        ],
        favorites: [],
        lastUsedModel: null,
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )
    const service = new ProviderRegistry(rootPath, createLogger(), {})
    service.registerFamily({
      type: 'claude-web',
      fetchCatalog: async () => [
        {
          modelId: 'claude-sonnet-5',
          name: 'Sonnet 5',
          group: 'Claude Web',
          capabilities: { chat: true, vision: true, imageGeneration: false, reasoning: true },
          reasoningEfforts: ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'off'],
        },
      ],
    })
    await service.initialize()

    const editor = service.getEditorData('claude-web')
    expect(editor.catalogModels.map((model) => model.modelId)).toEqual(['claude-sonnet-5'])
    expect(editor.selectedModelIds).toEqual(['claude-sonnet-5'])
    expect(
      editor.catalogModels.find((model) => model.modelId === 'claude-sonnet-5')?.reasoningEfforts,
    ).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max', 'off'])
  })

  it('configures the OpenRouter batch endpoint for existing built-in providers once', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        providers: [
          {
            id: 'openrouter',
            name: 'OpenRouter',
            type: 'openai-compatible',
            baseUrl: 'https://openrouter.ai/api/v1',
            builtin: true,
            enabled: true,
            apiKey: 'router-key',
            models: [],
            selectedModelIds: [],
          },
        ],
        favorites: [],
        lastUsedModel: null,
        quickModel: null,
        titleGenerationEnabled: true,
      }),
    )

    const upgraded = await createRegistry()
    expect(upgraded.getEditorData('openrouter').batchUrl).toBe(
      'https://openrouter.ai/api/beta/batches',
    )
  })

  it('appends new providers without testing their URL and stores the API key as plaintext', async () => {
    const snapshot = await registry.save({
      type: 'openai-compatible',
      name: 'Unavailable Provider',
      baseUrl: 'https://www.asd.asd',
      apiKey: 'visible-secret-key',
      catalogModels: [],
      selectedModelIds: [],
    })

    const added = snapshot.providers.at(-1)
    expect(added).toMatchObject({ name: 'Unavailable Provider', enabled: true })
    expect(registry.getEditorData(added?.id ?? '').apiKey).toBe('visible-secret-key')

    const stored = await readFile(join(rootPath, 'providers.json'), 'utf8')
    expect(stored).toContain('"apiKey": "visible-secret-key"')
    expect(stored).not.toContain('encryptedApiKey')
  })

  it('persists batch configuration only for the built-in OpenRouter provider', async () => {
    const snapshot = await registry.save({
      id: 'openrouter',
      type: 'openai-compatible',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      batchUrl: 'https://openrouter.ai/api/beta/batches/',
      batchPollIntervalSeconds: 45,
      batchModelRegex: 'batch-only',
      apiKey: 'batch-key',
      catalogModels: [catalogModel('vendor/model:batch')],
      selectedModelIds: ['vendor/model:batch'],
    })

    const provider = snapshot.providers.find((item) => item.id === 'openrouter')
    expect(provider).toMatchObject({
      batchUrl: 'https://openrouter.ai/api/beta/batches',
      batchPollIntervalSeconds: 45,
      batchModelRegex: 'batch-only',
    })
    expect(registry.getEditorData('openrouter')).toMatchObject({
      batchUrl: 'https://openrouter.ai/api/beta/batches',
      batchPollIntervalSeconds: 45,
      batchModelRegex: 'batch-only',
    })
  })

  it('persists the exact provider order supplied by drag and drop', async () => {
    const originalIds = registry.snapshot().providers.map((provider) => provider.id)
    const reversedIds = [...originalIds].reverse()

    const snapshot = await registry.reorder(reversedIds)

    expect(snapshot.providers.map((provider) => provider.id)).toEqual(reversedIds)
  })

  it('persists only explicitly selected models in the provider file', async () => {
    await registry.save({
      type: 'openai-compatible',
      name: 'Selected Only Provider',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'key',
      catalogModels: [catalogModel('model-a'), catalogModel('model-b'), catalogModel('model-c')],
      selectedModelIds: ['model-a', 'model-c'],
    })
    const added = registry.snapshot().providers.at(-1)
    expect(
      registry.getEditorData(added?.id ?? '').catalogModels.map((model) => model.modelId),
    ).toEqual(['model-a', 'model-c'])

    const stored = await readFile(join(rootPath, 'providers.json'), 'utf8')
    expect(stored).toContain('"modelId": "model-a"')
    expect(stored).toContain('"modelId": "model-c"')
    expect(stored).not.toContain('"modelId": "model-b"')
  })

  it('uses the unsaved form API key while fetching a model catalog', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer draft-key')
      expect(headers['x-api-key']).toBe('draft-key')
      return new Response(
        JSON.stringify({ data: [{ id: 'vendor/model-one', owned_by: 'Vendor' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const models = await registry.fetchModelCatalog({
      type: 'openai-compatible',
      name: 'Draft Provider',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'draft-key',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(models).toMatchObject([{ modelId: 'vendor/model-one', group: 'vendor' }])
  })

  it('does not infer reasoning options from OpenAI-compatible model names', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
              { id: 'anthropic/claude-fable-5' },
              { id: 'moonshotai/kimi-k3' },
              { id: 'openai/gpt-4o' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await registry.fetchModelCatalog({
      type: 'openai-compatible',
      name: 'Router',
      baseUrl: 'https://openrouter.example/api/v1',
      apiKey: '',
    })

    /** Finds one normalized catalog model by its provider model identifier. */
    const find = (modelId: string): ProviderModelDefinition | undefined =>
      models.find((model) => model.modelId === modelId)
    expect(find('anthropic/claude-opus-5')?.capabilities.reasoning).toBe(false)
    expect(find('anthropic/claude-fable-5')?.capabilities.reasoning).toBe(false)
    expect(find('moonshotai/kimi-k3')?.capabilities.reasoning).toBe(false)
    expect(find('openai/gpt-4o')?.capabilities.reasoning).toBe(false)
    expect(find('anthropic/claude-opus-5')?.reasoningEfforts).toBeUndefined()
    expect(find('moonshotai/kimi-k3')?.reasoningEfforts).toBeUndefined()
    expect(find('openai/gpt-4o')?.reasoningEfforts).toBeUndefined()
  })

  it('fills reasoning levels from OpenRouter supported_efforts metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'openai/gpt-6-astra',
                  name: 'OpenAI: GPT-6 Astra',
                  reasoning: {
                    mandatory: true,
                    supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'bogus level!'],
                  },
                },
                { id: 'plain/model', reasoning: { mandatory: false } },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )

    const models = await registry.fetchModelCatalog({
      type: 'openai-compatible',
      name: 'Router',
      baseUrl: 'https://openrouter.example/api/v1',
      apiKey: '',
    })

    /** Finds one normalized catalog model by its provider model identifier. */
    const find = (modelId: string): ProviderModelDefinition | undefined =>
      models.find((model) => model.modelId === modelId)
    expect(find('openai/gpt-6-astra')?.capabilities.reasoning).toBe(true)
    expect(find('openai/gpt-6-astra')?.reasoningEfforts).toEqual([
      'default',
      'max',
      'xhigh',
      'high',
      'medium',
      'low',
    ])
    expect(find('plain/model')?.capabilities.reasoning).toBe(false)
    expect(find('plain/model')?.reasoningEfforts).toBeUndefined()
  })

  it('assigns the openai-compatible type to legacy provider files without a type field', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        providers: [
          {
            id: 'legacy',
            name: 'Legacy',
            baseUrl: 'https://legacy.example/v1',
            builtin: false,
            enabled: true,
            apiKey: '',
            models: [],
            selectedModelIds: [],
          },
        ],
      }),
    )
    const service = await createRegistry()
    const snapshot = service.snapshot()
    expect(snapshot.providers.find((provider) => provider.id === 'legacy')?.type).toBe(
      'openai-compatible',
    )
    expect(service.getEditorData('legacy').type).toBe('openai-compatible')
  })

  it('drops providers from removed families when loading a stored file', async () => {
    await writeFile(
      join(rootPath, 'providers.json'),
      JSON.stringify({
        revision: 1,
        providers: [
          {
            id: 'codex',
            name: 'Codex',
            type: 'codex',
            baseUrl: '',
            builtin: true,
            enabled: true,
            apiKey: '',
            models: [],
            selectedModelIds: [],
          },
        ],
      }),
    )
    const service = await createRegistry()
    const snapshot = service.snapshot()
    expect(snapshot.providers.some((provider) => provider.id === 'codex')).toBe(false)
  })

  it('ships one built-in provider per login family with a locked type', async () => {
    const snapshot = registry.snapshot()
    expect(snapshot.providers.slice(0, 5).map((provider) => provider.id)).toEqual([
      'opencode',
      'deepseek',
      'chatgpt',
      'claude-web',
      'nvidia',
    ])
    const byId = new Map(snapshot.providers.map((provider) => [provider.id, provider]))
    expect(byId.get('opencode')).toMatchObject({ enabled: true })
    expect(byId.get('chatgpt')).toMatchObject({ type: 'chatgpt', builtin: true })
    expect(byId.get('claude-web')).toMatchObject({ type: 'claude-web', builtin: true })
    expect(
      snapshot.providers.filter((provider) => provider.enabled).map((provider) => provider.id),
    ).toEqual(['opencode'])
    expect(byId.get('nvidia')).toMatchObject({
      type: 'openai-compatible',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      builtin: true,
    })
    expect(byId.get('openrouter')).toMatchObject({
      batchUrl: 'https://openrouter.ai/api/beta/batches',
      builtin: true,
    })
    expect(byId.get('inferx')).toBeUndefined()
    expect(byId.get('ollama')).toMatchObject({ name: 'Ollama Local', builtin: true })
    await expect(registry.delete('chatgpt')).rejects.toThrow('Built-in providers')
  })

  it('imports and enables matching API keys only during clean-install initialization', async () => {
    const importRoot = join(rootPath, 'environment-import')
    const first = new ProviderRegistry(importRoot, createLogger(), {
      OPENCODE_API_KEY: 'opencode-from-environment',
      OPENROUTER_API_KEY: 'openrouter-from-environment',
      DEEPSEEK_API_KEY: 'deepseek-from-environment',
      LM_STUDIO_API_KEY: 'lm-studio-from-environment',
      CHATGPT_API_KEY: 'ignored-login-provider-key',
    })
    await first.initialize()

    const firstSnapshot = first.snapshot()
    expect(first.getEditorData('opencode').apiKey).toBe('opencode-from-environment')
    expect(first.getEditorData('openrouter').apiKey).toBe('openrouter-from-environment')
    expect(first.getEditorData('deepseek').apiKey).toBe('deepseek-from-environment')
    expect(first.getEditorData('lm-studio').apiKey).toBe('lm-studio-from-environment')
    expect(firstSnapshot.providers.find((provider) => provider.id === 'openrouter')?.enabled).toBe(
      true,
    )
    expect(firstSnapshot.providers.find((provider) => provider.id === 'deepseek')?.enabled).toBe(
      true,
    )
    expect(first.getEditorData('chatgpt').apiKey).toBe('')

    const reloaded = new ProviderRegistry(importRoot, createLogger(), {
      OPENROUTER_API_KEY: 'changed-after-first-launch',
    })
    await reloaded.initialize()
    expect(reloaded.getEditorData('openrouter').apiKey).toBe('openrouter-from-environment')
  })

  it('routes chatgpt model catalogs through the registered family', async () => {
    const models = [catalogModel('gpt-5')]
    const family: ProviderFamily = { type: 'chatgpt', fetchCatalog: vi.fn(async () => models) }
    registry.registerFamily(family)

    const fetched = await registry.fetchModelCatalog({
      type: 'chatgpt',
      id: 'chatgpt',
      name: 'ChatGPT',
    })

    expect(family.fetchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chatgpt', type: 'chatgpt' }),
    )
    expect(fetched).toEqual(models)
  })

  it('resolves a selected model with its plaintext key for chat requests', () => {
    const resolved = registry.resolve({
      providerId: 'opencode',
      modelId: 'deepseek/deepseek-v3-free',
    })

    expect(resolved.apiKey).toBe('public')
    expect(resolved.provider).toMatchObject({ id: 'opencode', enabled: true })
    expect(resolved.modelDefinition).toMatchObject({ modelId: 'deepseek/deepseek-v3-free' })
  })

  it('persists favorites and the last-used model for selected models', async () => {
    const reference: ModelReference = {
      providerId: 'opencode',
      modelId: 'deepseek/deepseek-v3-free',
    }
    await registry.setFavorite(reference, true)
    expect(registry.snapshot().favorites).toEqual([reference])

    const updated = await registry.setLastUsedModel(reference)
    expect(updated.lastUsedModel).toEqual(reference)
  })

  it('removes a disabled provider models from the chat selector', async () => {
    const disabled = await registry.setEnabled('opencode', false)

    expect(disabled.providers.find((provider) => provider.id === 'opencode')?.enabled).toBe(false)
    expect(disabled.models).toEqual([])
  })
})
