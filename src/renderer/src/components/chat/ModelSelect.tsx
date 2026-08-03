/** Renders a searchable centered model selector with favorites and capability icons. */

import { useDeferredValue, useMemo, useState } from 'react'
import { Button, Input, Modal, Tooltip } from 'antd'
import { Bot, Brain, ChevronsUpDown, Eye, Image, Search, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelDescriptor, ModelReference, ProviderSummary } from '@shared/index'
import { getSearchMatchScore } from '@renderer/utils/modelSearch'
import ModelAvatar from './ModelAvatar'
import styles from './ModelSelect.module.scss'

/** Properties accepted by the reusable provider-qualified model picker. */
export interface ModelSelectProps {
  models: ModelDescriptor[]
  providers: ProviderSummary[]
  value: ModelReference | null
  disabled?: boolean
  allowClear?: boolean
  className?: string
  onChange: (model: ModelReference | null) => void
  onFavorite?: (model: ModelReference, favorite: boolean) => void
}

/** Encodes a model pair into an unambiguous scalar value. */
export const modelReferenceKey = (model: ModelReference): string =>
  `${encodeURIComponent(model.providerId)}::${encodeURIComponent(model.modelId)}`

/** Describes one ordered group in the searchable model catalog. */
interface ModelGroup {
  key: string
  label: string
  models: ModelDescriptor[]
}

/** Displays favorite chat models first and groups the remaining catalog by provider. */
const ModelSelect = ({
  models,
  providers,
  value,
  disabled,
  allowClear = false,
  className,
  onChange,
  onFavorite,
}: ModelSelectProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  )
  const chatModels = useMemo(() => models.filter((model) => model.capabilities.chat), [models])
  const selected = useMemo(
    () =>
      chatModels.find(
        (model) =>
          value !== null &&
          model.providerId === value.providerId &&
          model.modelId === value.modelId,
      ),
    [chatModels, value],
  )
  const groups = useMemo((): ModelGroup[] => {
    const scored: Array<{ model: ModelDescriptor; score: number }> = []
    for (const model of chatModels) {
      const score = getSearchMatchScore(deferredSearch, [
        { value: model.name, weight: 0, allowAbbreviation: true },
        { value: model.modelId, weight: 1, allowAbbreviation: true },
        { value: providerNames.get(model.providerId) ?? '', weight: 5 },
        { value: model.providerId, weight: 6 },
      ])
      if (score === null) continue
      scored.push({ model, score })
    }
    scored.sort((left, right) => left.score - right.score)
    const filtered = scored.map((entry) => entry.model)
    const favorites = filtered.filter((model) => model.favorite)
    const byProvider = new Map<string, ModelDescriptor[]>()
    for (const model of filtered) {
      if (model.favorite) continue
      const providerModels = byProvider.get(model.providerId) ?? []
      providerModels.push(model)
      byProvider.set(model.providerId, providerModels)
    }
    return [
      ...(favorites.length > 0
        ? [{ key: 'favorites', label: t('chat.favorites'), models: favorites }]
        : []),
      ...providers.flatMap((provider) => {
        const providerModels = byProvider.get(provider.id) ?? []
        return providerModels.length > 0
          ? [{ key: provider.id, label: provider.name, models: providerModels }]
          : []
      }),
    ]
  }, [chatModels, deferredSearch, providerNames, providers, t])

  /** Selects one model and closes the popup. */
  const select = (model: ModelReference | null): void => {
    onChange(model)
    setOpen(false)
    setSearch('')
  }

  /** Renders compact capability icons for one model. */
  const renderCapabilityIcons = (model: ModelDescriptor): React.JSX.Element => (
    <span className={styles.capabilityIcons}>
      {model.capabilities.vision && (
        <Tooltip title={t('chat.capabilities.vision')}>
          <Eye size={12} />
        </Tooltip>
      )}
      {model.capabilities.reasoning && (
        <Tooltip title={t('chat.capabilities.reasoning')}>
          <Brain size={12} />
        </Tooltip>
      )}
      {model.capabilities.imageGeneration && (
        <Tooltip title={t('chat.capabilities.image')}>
          <Image size={12} />
        </Tooltip>
      )}
    </span>
  )

  return (
    <>
      <Button
        type="text"
        disabled={disabled ?? false}
        className={`${styles.trigger} ${className ?? ''}`}
        aria-label={t('chat.selectModel')}
        onClick={() => setOpen(true)}
      >
        {selected ? (
          <ModelAvatar model={selected} size={22} />
        ) : (
          <span className={styles.modelAvatar}>
            <Bot size={15} />
          </span>
        )}
        <span className={styles.triggerText}>
          {selected ? selected.name : t('chat.selectModel')}
          {selected && (
            <small>{providerNames.get(selected.providerId) ?? selected.providerId}</small>
          )}
        </span>
        <ChevronsUpDown size={14} />
      </Button>
      <Modal
        width={520}
        title={null}
        open={open}
        footer={null}
        centered
        closable={false}
        destroyOnHidden
        onCancel={() => {
          setOpen(false)
          setSearch('')
        }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Input
          allowClear
          autoFocus
          prefix={<Search size={14} />}
          value={search}
          placeholder={t('chat.filterByTag')}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className={styles.catalog}>
          {groups.length === 0 ? (
            <div className={styles.noModels}>{t('chat.noModels')}</div>
          ) : (
            groups.map((group) => (
              <section className={styles.group} key={group.key}>
                <div className={styles.groupLabel}>{group.label}</div>
                {group.models.map((model) => (
                  <div
                    className={`${styles.option} ${modelReferenceKey(model) === (value ? modelReferenceKey(value) : '') ? styles.selected : ''}`}
                    key={modelReferenceKey(model)}
                  >
                    <button
                      type="button"
                      className={styles.optionMain}
                      onClick={() => select(model)}
                    >
                      <ModelAvatar model={model} size={22} />
                      <span className={styles.optionText}>
                        <strong>{model.name}</strong>
                        <small>{providerNames.get(model.providerId) ?? model.providerId}</small>
                      </span>
                    </button>
                    <span className={styles.optionRight}>
                      {renderCapabilityIcons(model)}
                      {onFavorite && (
                        <Tooltip
                          title={model.favorite ? t('chat.removeFavorite') : t('chat.addFavorite')}
                        >
                          <Button
                            type="text"
                            size="small"
                            className={model.favorite ? (styles.favorite ?? '') : ''}
                            icon={
                              <Star size={14} fill={model.favorite ? 'currentColor' : 'none'} />
                            }
                            onClick={() => onFavorite(model, !model.favorite)}
                          />
                        </Tooltip>
                      )}
                    </span>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
        {allowClear && value && (
          <Button
            className={styles.clearButton ?? ''}
            type="text"
            danger
            onClick={() => select(null)}
          >
            {t('chat.clearModel')}
          </Button>
        )}
      </Modal>
    </>
  )
}

export default ModelSelect
