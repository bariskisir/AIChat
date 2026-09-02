/** Renders draggable providers, type-aware editing, login panels, and saved model selections. */

import type { DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
} from 'antd'
import {
  Brain,
  Copy,
  Eye,
  GripVertical,
  Image,
  ListRestart,
  LogIn,
  LogOut,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  PROVIDER_TYPES,
  type ModelDescriptor,
  type ProviderAuthStatus,
  type ProviderConnectionInput,
  type ProviderInput,
  type ProviderModelDefinition,
  type ProviderSummary,
  type ProviderType,
  type ProviderUsageState,
} from '@shared/index'
import { createLogger } from '@renderer/services/LoggerService'
import { formatMonthDayTime } from '@renderer/utils/formatters'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setProviders } from '@renderer/store/appSlice'
import ProviderModelCatalogModal from './ProviderModelCatalogModal'
import styles from '../SettingsPage.module.scss'

const logger = createLogger('ProviderSettings')

/** Draft values accepted by the provider settings modal. */
interface ProviderFormValues {
  type: ProviderType
  name: string
  baseUrl?: string
  batchUrl?: string
  batchPollIntervalSeconds?: number
  batchModelRegex?: string
  apiKey?: string
  customHeadersJson?: string
}

const BATCH_POLL_INTERVAL_LIMITS = { min: 1, max: 3600 } as const

/** Parses the JSON header draft into a string record, or returns null when invalid. */
const parseCustomHeadersJson = (value: string): Record<string, string> | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) return {}
  const valid = entries.every(
    ([key, item]) => key.trim().length > 0 && typeof item === 'string' && item.trim().length > 0,
  )
  if (!valid) return null
  return Object.fromEntries(entries) as Record<string, string>
}

/** Draft values accepted by the manual-model popup. */
interface ManualModelFormValues {
  name: string
  modelId: string
}

/** Derives a compact catalog group from a manual model identifier or provider name. */
const manualModelGroup = (modelId: string, providerName: string): string => {
  const pathGroup = modelId.includes('/') ? modelId.split('/')[0]?.trim() : ''
  return (pathGroup || providerName.trim() || 'Manual').slice(0, 200)
}

/** Renders the sign-in status, login actions, and usage limits for one login-based provider. */
const ProviderAuthPanel = ({
  providerId,
  type,
}: {
  providerId: string
  type: ProviderType
}): React.JSX.Element | null => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [status, setStatus] = useState<ProviderAuthStatus | null>(null)
  const [usage, setUsage] = useState<ProviderUsageState | null>(null)
  const [loading, setLoading] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)
  const wasSignedIn = useRef(false)

  /** Loads the renderer-safe authentication state for one provider. */
  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.app.getProviderAuthStatus(providerId, type))
    } catch (error) {
      logger.error('Provider auth status could not be loaded.', error)
    }
  }, [providerId, type])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  /** Polls while a login window or browser login is completing, then stops when signed in. */
  useEffect(() => {
    if (type !== 'chatgpt' && type !== 'claude-web') return
    if (!status?.signingIn) return
    const timer = setInterval(() => {
      void window.app.getProviderAuthStatus(providerId, type).then((next) => {
        setStatus(next)
        if (!next.signingIn) clearInterval(timer)
      })
    }, 2_000)
    return () => clearInterval(timer)
  }, [providerId, type, status?.signingIn])

  /** Starts the native sign-in flow for the login family of this provider. */
  const signIn = async (): Promise<void> => {
    setLoading(true)
    try {
      await window.app.startProviderSignIn(providerId, type)
      await loadStatus()
    } catch (error) {
      logger.error('Provider sign-in could not be started.', error)
      void message.error(t('providers.signInFailed'))
    } finally {
      setLoading(false)
    }
  }

  /** Clears stored credentials for one login-based provider. */
  const signOut = async (): Promise<void> => {
    setLoading(true)
    try {
      await window.app.signOutProvider(providerId, type)
      setStatus(null)
      setUsage(null)
      await loadStatus()
    } catch (error) {
      logger.error('Provider sign-out failed.', error)
      void message.error(t('providers.signOutFailed'))
    } finally {
      setLoading(false)
    }
  }

  /** Fetches the rate-limit overview for a signed-in ChatGPT-style provider. */
  const fetchUsage = useCallback(
    async (silent = false): Promise<void> => {
      setUsageLoading(true)
      try {
        setUsage(await window.app.fetchProviderUsage(providerId))
      } catch (error) {
        logger.error('Provider usage could not be loaded.', error)
        if (!silent) void message.error(t('providers.usageFailed'))
      } finally {
        setUsageLoading(false)
      }
    },
    [providerId, message, t],
  )

  /** Refreshes the usage overview once a ChatGPT provider becomes signed in, on open or after login. */
  useEffect(() => {
    if (type !== 'chatgpt') {
      wasSignedIn.current = false
      return
    }
    const signedIn = Boolean(status?.signedIn)
    if (signedIn && !wasSignedIn.current) {
      wasSignedIn.current = true
      void fetchUsage(true)
    } else if (!signedIn) {
      wasSignedIn.current = false
    }
  }, [type, status?.signedIn, fetchUsage])

  if (type === 'openai-compatible') return null
  return (
    <section className={styles.providerAuthPanel}>
      <header>
        <strong>{t('providers.authTitle')}</strong>
        <span
          className={`${styles.providerAuthBadge} ${
            status?.signedIn ? styles.providerAuthBadgeOn : ''
          }`}
        >
          {status?.signedIn ? t('providers.signedIn') : t('providers.signedOut')}
        </span>
      </header>
      <p className={styles.providerAuthHint}>
        {t('providers.authHint', { type: t(`providers.types.${type}`) })}
      </p>
      {status?.signedIn && (
        <div className={styles.providerAuthDetails}>
          {status.accountEmail && (
            <span>
              {t('providers.account')}: {status.accountEmail}
            </span>
          )}
          {status.plan && (
            <span>
              {t('providers.plan')}: {status.plan}
            </span>
          )}
          {type === 'chatgpt' && (
            <span>
              {t('providers.refreshToken')}:{' '}
              {status.hasRefreshToken
                ? t('providers.refreshTokenYes')
                : t('providers.refreshTokenNo')}
            </span>
          )}
        </div>
      )}
      <div className={styles.providerAuthActions}>
        {status?.signedIn ? (
          <Button
            size="small"
            icon={<LogOut size={13} />}
            loading={loading}
            onClick={() => void signOut()}
          >
            {t('providers.signOut')}
          </Button>
        ) : (
          <Button
            size="small"
            type="primary"
            icon={<LogIn size={13} />}
            loading={Boolean(loading || status?.signingIn)}
            onClick={() => void signIn()}
          >
            {t('providers.signIn')}
          </Button>
        )}
        {type === 'chatgpt' && status?.signedIn && (
          <Button
            size="small"
            icon={<RefreshCw size={13} />}
            loading={usageLoading}
            onClick={() => void fetchUsage()}
          >
            {t('providers.fetchUsage')}
          </Button>
        )}
      </div>
      {usage && usage.windows.length > 0 && (
        <div className={styles.providerUsageList}>
          {usage.windows.map((window) => (
            <div key={window.label} className={styles.providerUsageRow}>
              <div>
                <span>
                  {t('providers.usageWindow', { label: window.label, percent: window.percent })}
                </span>
                {window.resetAt > 0 && (
                  <small>
                    {t('providers.resetsAt')} {formatMonthDayTime(window.resetAt)}
                  </small>
                )}
              </div>
              <Progress percent={window.percent} size="small" strokeColor="#f56a00" />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Displays provider ordering, type-aware editing, login panels, and explicit model selection. */
const ProviderSettingsSection = (): React.JSX.Element => {
  const providers = useAppSelector((state) => state.app.providers.providers)
  const providersSnapshot = useAppSelector((state) => state.app.providers)
  const dispatch = useAppDispatch()
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [form] = Form.useForm<ProviderFormValues>()
  const [manualModelForm] = Form.useForm<ManualModelFormValues>()
  const [editing, setEditing] = useState<ProviderSummary | null | 'new'>(null)
  const [catalogModels, setCatalogModels] = useState<ProviderModelDefinition[]>([])
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [manualModelOpen, setManualModelOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [loadingEditorId, setLoadingEditorId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const editingProvider = editing === 'new' ? null : editing
  const isEditingOpenRouter = editingProvider?.id === 'openrouter'
  const selectedType = Form.useWatch('type', form) ?? 'openai-compatible'
  const selectedModels = useMemo(() => {
    const selected = new Set(selectedModelIds)
    return catalogModels.filter((model) => selected.has(model.modelId))
  }, [catalogModels, selectedModelIds])
  const selectedGroups = useMemo(() => {
    const grouped = new Map<string, ProviderModelDefinition[]>()
    for (const model of selectedModels) {
      const models = grouped.get(model.group) ?? []
      models.push(model)
      grouped.set(model.group, models)
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [selectedModels])

  /** Opens a blank provider form that can fetch models before the provider is saved. */
  const beginAdd = (): void => {
    form.resetFields()
    form.setFieldsValue({
      type: 'openai-compatible',
      name: '',
      baseUrl: '',
      apiKey: '',
      customHeadersJson: '',
    })
    setCatalogModels([])
    setSelectedModelIds([])
    setCatalogOpen(false)
    setManualModelOpen(false)
    setEditing('new')
  }

  /** Loads the retrievable API key, type, and persisted catalog before opening an existing provider. */
  const beginEdit = async (provider: ProviderSummary): Promise<void> => {
    setLoadingEditorId(provider.id)
    try {
      const data = await window.app.getProviderEditorData(provider.id)
      form.resetFields()
      form.setFieldsValue({
        type: data.type,
        name: data.name,
        baseUrl: data.baseUrl ?? '',
        batchUrl: data.batchUrl ?? '',
        batchPollIntervalSeconds: data.batchPollIntervalSeconds ?? 30,
        batchModelRegex: data.batchModelRegex ?? 'batch',
        apiKey: data.apiKey ?? '',
        customHeadersJson:
          data.customHeaders && Object.keys(data.customHeaders).length > 0
            ? JSON.stringify(data.customHeaders)
            : '',
      })
      setCatalogModels(data.catalogModels)
      setSelectedModelIds(data.selectedModelIds)
      setCatalogOpen(false)
      setManualModelOpen(false)
      setEditing(provider)
    } catch (error) {
      logger.error('Provider editor data could not be loaded.', error)
      void message.error(t('errors.generic'))
    } finally {
      setLoadingEditorId(null)
    }
  }

  /** Validates and returns current connection fields for save and catalog fetch requests. */
  const readConnectionValues = async (): Promise<ProviderConnectionInput | null> => {
    let values: ProviderFormValues
    try {
      values = await form.validateFields()
    } catch {
      return null
    }
    const customHeaders = values.customHeadersJson?.trim()
      ? parseCustomHeadersJson(values.customHeadersJson)
      : {}
    if (customHeaders === null) {
      void message.error(t('providers.customHeadersInvalid'))
      return null
    }
    const containsNonAscii = (text: string): boolean =>
      [...text].some((char) => char.charCodeAt(0) > 0xff)
    if (
      Object.entries(customHeaders).some(
        ([key, value]) => containsNonAscii(key) || containsNonAscii(value),
      )
    ) {
      void message.error(t('providers.customHeadersInvalid'))
      return null
    }
    return {
      ...(editingProvider ? { id: editingProvider.id } : {}),
      type: values.type,
      name: values.name,
      ...(values.baseUrl ? { baseUrl: values.baseUrl } : {}),
      ...(isEditingOpenRouter && values.batchUrl ? { batchUrl: values.batchUrl } : {}),
      ...(isEditingOpenRouter && values.batchPollIntervalSeconds
        ? { batchPollIntervalSeconds: values.batchPollIntervalSeconds }
        : {}),
      ...(isEditingOpenRouter && values.batchModelRegex
        ? { batchModelRegex: values.batchModelRegex }
        : {}),
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
      ...(Object.keys(customHeaders).length > 0 ? { customHeaders } : {}),
    }
  }

  /** Persists provider fields, catalog, and explicit model selections without a network test. */
  const saveProvider = async (): Promise<void> => {
    const connection = await readConnectionValues()
    if (!connection) return
    if (connection.apiKey && [...connection.apiKey].some((char) => char.charCodeAt(0) > 0xff)) {
      void message.error(t('providers.apiKeyInvalid'))
      return
    }
    setSaving(true)
    try {
      const input: ProviderInput = {
        ...connection,
        catalogModels,
        selectedModelIds,
      }
      dispatch(setProviders(await window.app.saveProvider(input)))
      setEditing(null)
      void message.success(t('providers.saved'))
    } catch (error) {
      logger.error('Provider could not be saved.', error)
      void message.error(
        selectedType === 'chatgpt' || selectedType === 'claude-web'
          ? error instanceof Error
            ? error.message
            : t('providers.saveFailed')
          : t('providers.saveFailed'),
      )
    } finally {
      setSaving(false)
    }
  }

  /** Fetches models with the unsaved form values and opens the grouped selection popup. */
  const fetchModelList = async (): Promise<void> => {
    const connection = await readConnectionValues()
    if (!connection) return
    setFetching(true)
    try {
      const fetched = await window.app.fetchProviderCatalog(connection)
      const fetchedIds = new Set(fetched.map((model) => model.modelId))
      setCatalogModels(fetched)
      setSelectedModelIds((ids) => ids.filter((id) => fetchedIds.has(id)))
      setCatalogOpen(true)
      void message.success(t('providers.modelsRefreshed'))
    } catch (error) {
      logger.error('Provider models could not be fetched.', error)
      if (selectedType === 'chatgpt' || selectedType === 'claude-web') {
        const hint =
          editingProvider === null
            ? t('providers.authNeedsSave')
            : error instanceof Error
              ? error.message
              : t('providers.authNeedsSave')
        void message.error(hint)
      } else {
        void message.error(t('providers.fetchFailed'))
      }
    } finally {
      setFetching(false)
    }
  }

  /** Opens a blank two-field popup for providers without a model catalog endpoint. */
  const beginManualModelAdd = (): void => {
    manualModelForm.resetFields()
    setManualModelOpen(true)
  }

  /** Adds or renames one manual chat model and selects it in the current provider draft. */
  const addManualModel = async (): Promise<void> => {
    let values: ManualModelFormValues
    try {
      values = await manualModelForm.validateFields()
    } catch {
      return
    }
    const name = values.name.trim()
    const modelId = values.modelId.trim()
    const providerName = form.getFieldValue('name') ?? ''
    setCatalogModels((models) => {
      const existing = models.find((model) => model.modelId === modelId)
      if (existing) {
        return models.map((model) => (model.modelId === modelId ? { ...model, name } : model))
      }
      return [
        ...models,
        {
          modelId,
          name,
          group: manualModelGroup(modelId, providerName),
          capabilities: {
            chat: true,
            vision: false,
            imageGeneration: false,
            reasoning: false,
          },
        },
      ]
    })
    setSelectedModelIds((ids) => (ids.includes(modelId) ? ids : [...ids, modelId]))
    setManualModelOpen(false)
    void message.success(t('providers.manualModelAdded'))
  }

  /** Copies the complete plaintext API key currently loaded in the masked input. */
  const copyApiKey = async (): Promise<void> => {
    const apiKey = form.getFieldValue('apiKey')
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    void message.success(t('providers.apiKeyCopied'))
  }

  /** Enables or disables one provider without changing the saved row order. */
  const setProviderEnabled = async (provider: ProviderSummary, enabled: boolean): Promise<void> => {
    setTogglingId(provider.id)
    try {
      dispatch(setProviders(await window.app.setProviderEnabled(provider.id, enabled)))
    } catch (error) {
      logger.error('Provider enabled state could not be changed.', error)
      void message.error(t('errors.generic'))
    } finally {
      setTogglingId(null)
    }
  }

  /** Deletes a custom provider while built-in delete controls remain visibly disabled. */
  const deleteProvider = async (provider: ProviderSummary): Promise<void> => {
    if (provider.builtin) return
    try {
      dispatch(setProviders(await window.app.deleteProvider(provider.id)))
    } catch (error) {
      logger.error('Custom provider could not be deleted.', error)
      void message.error(t('errors.generic'))
    }
  }

  /** Reorders providers optimistically so the new order appears instantly, then persists it. */
  const reorderFromResult = (result: DropResult): void => {
    const destination = result.destination
    if (!destination || destination.index === result.source.index) return
    const ids = providers.map((provider) => provider.id)
    const sourceIndex = result.source.index
    const moved = ids[sourceIndex]
    if (moved === undefined) return
    ids.splice(sourceIndex, 1)
    ids.splice(destination.index, 0, moved)
    const previous = providersSnapshot
    const byId = new Map(providers.map((provider) => [provider.id, provider]))
    const reordered = ids
      .map((id) => byId.get(id))
      .filter((provider): provider is ProviderSummary => provider !== undefined)
    dispatch(setProviders({ ...previous, providers: reordered }))
    void window.app
      .reorderProviders(ids)
      .then((saved) => dispatch(setProviders(saved)))
      .catch((error) => {
        logger.error('Provider order could not be saved.', error)
        dispatch(setProviders(previous))
        void message.error(t('errors.generic'))
      })
  }

  /** Removes one selected model from the provider draft while keeping it in the fetched catalog. */
  const removeSelectedModel = (modelId: string): void => {
    setSelectedModelIds((ids) => ids.filter((id) => id !== modelId))
  }

  /** Removes all models belonging to one group from the selection. */
  const removeSelectedGroup = (group: string): void => {
    const groupIds = new Set(
      catalogModels.filter((model) => model.group === group).map((model) => model.modelId),
    )
    setSelectedModelIds((ids) => ids.filter((id) => !groupIds.has(id)))
  }

  /** Renders compact support badges for one selected model. */
  const renderCapabilities = (
    model: ProviderModelDefinition | ModelDescriptor,
  ): React.JSX.Element => (
    <span className={styles.providerModelCapabilities}>
      {model.capabilities.chat && (
        <span>
          <MessageSquare size={11} /> {t('chat.capabilities.chat')}
        </span>
      )}
      {model.capabilities.vision && (
        <span>
          <Eye size={11} /> {t('chat.capabilities.vision')}
        </span>
      )}
      {model.capabilities.reasoning && (
        <span>
          <Brain size={11} /> {t('chat.capabilities.reasoning')}
        </span>
      )}
      {model.capabilities.imageGeneration && (
        <span>
          <Image size={11} /> {t('chat.capabilities.image')}
        </span>
      )}
    </span>
  )

  return (
    <section className={styles.settingContainer}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t('providers.title')}</h2>
          <p>{t('providers.description')}</p>
        </div>
        <Button type="primary" icon={<Plus size={15} />} onClick={beginAdd}>
          {t('providers.add')}
        </Button>
      </div>
      <DragDropContext onDragEnd={reorderFromResult}>
        <Droppable droppableId="providers">
          {(droppableProvided) => (
            <div
              className={styles.providerList}
              ref={droppableProvided.innerRef}
              {...droppableProvided.droppableProps}
            >
              {providers.map((provider, index) => (
                <Draggable key={provider.id} draggableId={provider.id} index={index}>
                  {(draggableProvided, draggableSnapshot) => (
                    <article
                      className={`${styles.providerCard} ${draggableSnapshot.isDragging ? styles.providerDragging : ''}`}
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      {...draggableProvided.dragHandleProps}
                    >
                      <GripVertical className={styles.providerDragHandle} size={17} />
                      <div className={styles.providerIdentity}>
                        <strong>{provider.name}</strong>
                        <span>{t(`providers.types.${provider.type}`)}</span>
                      </div>
                      <Switch
                        checked={provider.enabled}
                        loading={togglingId === provider.id}
                        aria-label={t('providers.enabled')}
                        onChange={(enabled) => void setProviderEnabled(provider, enabled)}
                      />
                      <span className={styles.providerModelCount}>
                        {t('providers.modelCount', { count: provider.modelCount })}
                      </span>
                      <Button
                        type="text"
                        loading={loadingEditorId === provider.id}
                        aria-label={t('common.edit')}
                        icon={<Settings2 size={15} />}
                        onClick={() => void beginEdit(provider)}
                      />
                      <Button
                        type="text"
                        danger
                        disabled={provider.builtin}
                        aria-label={t('common.delete')}
                        icon={<Trash2 size={15} />}
                        onClick={() => void deleteProvider(provider)}
                      />
                    </article>
                  )}
                </Draggable>
              ))}
              {droppableProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <Modal
        width={720}
        className={styles.providerEditorModal ?? ''}
        title={editing === 'new' ? t('providers.addTitle') : t('providers.editTitle')}
        open={editing !== null}
        okText={t('providers.save')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        onOk={() => void saveProvider()}
        onCancel={() => setEditing(null)}
        destroyOnHidden
        forceRender
      >
        {selectedType === 'claude-web' && (
          <Alert
            type="warning"
            showIcon
            title={t('providers.claudeWebThirdPartyWarning')}
            className={styles.providerThirdPartyWarning ?? ''}
          />
        )}
        <Form
          form={form}
          className={styles.providerEditorForm ?? ''}
          labelAlign="left"
          labelCol={{ flex: '120px' }}
          wrapperCol={{ flex: 1 }}
          requiredMark={false}
        >
          <Form.Item name="type" label={t('providers.type')}>
            <Select
              disabled={editing !== 'new'}
              options={PROVIDER_TYPES.map((type) => ({
                value: type,
                label: t(`providers.types.${type}`),
              }))}
            />
          </Form.Item>
          <Form.Item name="name" label={t('providers.name')} rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          {selectedType === 'openai-compatible' && (
            <>
              <Form.Item
                name="baseUrl"
                label={t('providers.baseUrl')}
                rules={[{ required: true }, { type: 'url' }]}
              >
                <Input placeholder={t('providers.baseUrlPlaceholder')} />
              </Form.Item>
              {isEditingOpenRouter && (
                <>
                  <Form.Item
                    name="batchUrl"
                    label={t('providers.batchUrl')}
                    rules={[{ type: 'url' }]}
                  >
                    <Input placeholder={t('providers.batchUrlPlaceholder')} />
                  </Form.Item>
                  <Form.Item label={t('models.batchPollInterval')}>
                    <Space.Compact>
                      <Form.Item
                        name="batchPollIntervalSeconds"
                        noStyle
                        rules={[{ required: true }]}
                      >
                        <InputNumber
                          className={styles.durationInput ?? ''}
                          min={BATCH_POLL_INTERVAL_LIMITS.min}
                          max={BATCH_POLL_INTERVAL_LIMITS.max}
                        />
                      </Form.Item>
                      <Input
                        className={styles.durationUnit ?? ''}
                        value={t('models.seconds')}
                        readOnly
                        tabIndex={-1}
                      />
                    </Space.Compact>
                  </Form.Item>
                  <Form.Item
                    name="batchModelRegex"
                    label={t('models.batchModelRegex')}
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </>
              )}
              <Form.Item label={t('providers.apiKey')}>
                <Space.Compact block>
                  <Form.Item name="apiKey" noStyle>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button
                    aria-label={t('providers.copyApiKey')}
                    icon={<Copy size={15} />}
                    onClick={() => void copyApiKey()}
                  />
                </Space.Compact>
              </Form.Item>
              <Form.Item name="customHeadersJson" label={t('providers.customHeaders')}>
                <Input placeholder='{"User-Agent": "opencode"}' spellCheck={false} />
              </Form.Item>
            </>
          )}
        </Form>
        {selectedType !== 'openai-compatible' &&
          (editingProvider ? (
            <ProviderAuthPanel providerId={editingProvider.id} type={selectedType} />
          ) : (
            <section className={styles.providerAuthPanel}>
              <p className={styles.providerAuthHint}>{t('providers.authNeedsSave')}</p>
            </section>
          ))}
        <section className={styles.providerModelsSection}>
          <header>
            <div>
              <strong>{t('providers.models')}</strong>
              <span>{t('providers.modelCount', { count: selectedModels.length })}</span>
            </div>
            <Space.Compact>
              <Button
                icon={<ListRestart size={14} />}
                loading={fetching}
                onClick={() => void fetchModelList()}
              >
                {t('providers.fetchModelList')}
              </Button>
              {selectedType === 'openai-compatible' && (
                <Button
                  aria-label={t('providers.manualModel')}
                  title={t('providers.manualModel')}
                  icon={<Plus size={14} />}
                  onClick={beginManualModelAdd}
                />
              )}
            </Space.Compact>
          </header>
          <div className={styles.selectedModelGroups}>
            {selectedGroups.length === 0 ? (
              <div className={styles.providerModelsEmpty}>{t('providers.noSelectedModels')}</div>
            ) : (
              selectedGroups.map(([group, models]) => (
                <section key={group}>
                  <header>
                    <strong>{group}</strong>
                    <span>{models.length}</span>
                    <Button
                      type="text"
                      size="small"
                      aria-label={t('providers.removeGroup')}
                      icon={<Minus size={14} />}
                      onClick={() => removeSelectedGroup(group)}
                    />
                  </header>
                  {models.map((model) => (
                    <article key={model.modelId}>
                      <div>
                        <strong>{model.name}</strong>
                        <small>{model.modelId}</small>
                      </div>
                      {renderCapabilities(model)}
                      <Button
                        type="text"
                        size="small"
                        aria-label={t('providers.removeModel')}
                        icon={<Minus size={13} />}
                        onClick={() => removeSelectedModel(model.modelId)}
                      />
                    </article>
                  ))}
                </section>
              ))
            )}
          </div>
        </section>
      </Modal>
      <Modal
        width={680}
        centered
        title={t('providers.manualModelTitle')}
        open={manualModelOpen}
        okText={t('providers.addModel')}
        cancelText={t('common.cancel')}
        onOk={() => void addManualModel()}
        onCancel={() => setManualModelOpen(false)}
        destroyOnHidden
        forceRender
      >
        <Form
          form={manualModelForm}
          className={styles.manualModelForm ?? ''}
          labelAlign="left"
          labelCol={{ flex: '96px' }}
          wrapperCol={{ flex: 1 }}
          requiredMark={false}
        >
          <Form.Item
            name="name"
            label={t('providers.modelName')}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={500} />
          </Form.Item>
          <Form.Item
            name="modelId"
            label={t('providers.modelId')}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
      <ProviderModelCatalogModal
        open={catalogOpen}
        providerName={editingProvider?.name ?? form.getFieldValue('name') ?? ''}
        catalog={catalogModels}
        selectedModelIds={selectedModelIds}
        onChange={setSelectedModelIds}
        onClose={() => setCatalogOpen(false)}
      />
    </section>
  )
}

export default ProviderSettingsSection
