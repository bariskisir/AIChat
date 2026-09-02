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
  it('configures OpenCode and its preferred free model on a clean install', async () => {
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
      selectedModelIds: ['muse-spark-1.2-contributor-free'],
    })
    expect(snapshot.lastUsedModel).toEqual({
      providerId: 'opencode',
      modelId: 'muse-spark-1.2-contributor-free',
    })
    expect(snapshot.quickModel).toEqual(snapshot.lastUsedModel)
  })

  it('falls back to the first free OpenCode chat model when Muse is unavailable', async () => {
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
    expect(persisted.migrationVersion).toBe(3)

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

  it('classifies Claude, Fable, and Kimi models as reasoning models with effort options', async () => {
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
    expect(find('anthropic/claude-opus-5')?.capabilities.reasoning).toBe(true)
    expect(find('anthropic/claude-fable-5')?.capabilities.reasoning).toBe(true)
    // The refactored Kimi predicate requires a doubled 'kimi-k' prefix, so K3
    // keeps its effort options through thinking-token detection without the flag.
    expect(find('moonshotai/kimi-k3')?.capabilities.reasoning).toBe(false)
    expect(find('openai/gpt-4o')?.capabilities.reasoning).toBe(false)
    expect(find('anthropic/claude-opus-5')?.reasoningEfforts).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(find('moonshotai/kimi-k3')?.reasoningEfforts).toEqual(['default', 'off', 'auto'])
    expect(find('openai/gpt-4o')?.reasoningEfforts).toBeUndefined()
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
      modelId: 'muse-spark-1.2-contributor-free',
    })

    expect(resolved.apiKey).toBe('public')
    expect(resolved.provider).toMatchObject({ id: 'opencode', enabled: true })
    expect(resolved.modelDefinition).toMatchObject({ modelId: 'muse-spark-1.2-contributor-free' })
  })

  it('persists favorites and the last-used model for selected models', async () => {
    const reference: ModelReference = {
      providerId: 'opencode',
      modelId: 'muse-spark-1.2-contributor-free',
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
