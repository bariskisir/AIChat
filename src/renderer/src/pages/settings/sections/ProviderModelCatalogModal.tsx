/** Renders a provider catalog with group and model selection controls. */

import { useDeferredValue, useMemo, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { Brain, ChevronRight, Eye, Image, MessageSquare, Minus, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProviderModelDefinition } from '@shared/index'
import styles from '../SettingsPage.module.scss'

/** Properties accepted by the provider catalog selection modal. */
export interface ProviderModelCatalogModalProps {
  open: boolean
  providerName: string
  catalog: ProviderModelDefinition[]
  selectedModelIds: string[]
  onChange: (selectedModelIds: string[]) => void
  onClose: () => void
}

/** Checks every whitespace-delimited search term against one combined model search document. */
const matchesModelTerms = (model: ProviderModelDefinition, terms: string[]): boolean => {
  const target =
    `${model.name} ${model.modelId} ${model.group} ${model.ownedBy ?? ''}`.toLocaleLowerCase()
  return terms.every((term) => target.includes(term))
}

/** Lets users add or remove complete groups and individual models from a fetched catalog. */
const ProviderModelCatalogModal = ({
  open,
  providerName,
  catalog,
  selectedModelIds,
  onChange,
  onClose,
}: ProviderModelCatalogModalProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const selected = useMemo(() => new Set(selectedModelIds), [selectedModelIds])
  const allCatalogModelsSelected =
    catalog.length > 0 && catalog.every((model) => selected.has(model.modelId))
  const terms = useMemo(
    () => deferredSearch.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean),
    [deferredSearch],
  )
  const groups = useMemo(() => {
    const grouped = new Map<string, ProviderModelDefinition[]>()
    for (const model of catalog) {
      if (!matchesModelTerms(model, terms)) continue
      const models = grouped.get(model.group) ?? []
      models.push(model)
      grouped.set(model.group, models)
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [catalog, terms])

  /** Renders capability labels before a fetched model is added to the provider selection. */
  const renderCapabilities = (model: ProviderModelDefinition): React.JSX.Element => (
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

  /** Adds or removes one model while retaining catalog order in the saved identifier list. */
  const toggleModel = (modelId: string): void => {
    const next = new Set(selected)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    onChange(catalog.filter((model) => next.has(model.modelId)).map((model) => model.modelId))
  }

  /** Adds every model in a group, or removes the whole group when it is already selected. */
  const toggleGroup = (models: ProviderModelDefinition[]): void => {
    const next = new Set(selected)
    const allSelected = models.every((model) => next.has(model.modelId))
    for (const model of models) {
      if (allSelected) next.delete(model.modelId)
      else next.add(model.modelId)
    }
    onChange(catalog.filter((model) => next.has(model.modelId)).map((model) => model.modelId))
  }

  /** Selects every fetched model or clears the complete fetched catalog selection. */
  const toggleCatalogSelection = (): void => {
    onChange(allCatalogModelsSelected ? [] : catalog.map((model) => model.modelId))
  }

  /** Collapses or expands one model family. */
  const toggleExpanded = (group: string): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  /** Increases the bounded rendered row count for one large expanded group. */
  const showMore = (group: string): void => {
    setVisibleLimits((limits) => ({ ...limits, [group]: (limits[group] ?? 60) + 100 }))
  }

  /** Closes the popup and clears transient search and expansion state. */
  const close = (): void => {
    setSearch('')
    setCollapsedGroups(new Set())
    setVisibleLimits({})
    onClose()
  }

  return (
    <Modal
      width={760}
      className={styles.providerCatalogModal ?? ''}
      title={t('providers.modelCatalogTitle', { provider: providerName })}
      open={open}
      footer={null}
      onCancel={close}
      destroyOnHidden
    >
      <div className={styles.catalogToolbar}>
        <Input
          allowClear
          prefix={<Search size={14} />}
          value={search}
          placeholder={t('providers.searchCatalog')}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span>
          {t('providers.selectedModels', {
            selected: selectedModelIds.length,
            total: catalog.length,
          })}
        </span>
      </div>
      <div className={styles.catalogGroups}>
        <section className={styles.catalogProviderGroup}>
          <header>
            <div>
              <strong>{providerName}</strong>
              <span>{catalog.length}</span>
            </div>
            <Button
              type="text"
              size="small"
              aria-label={
                allCatalogModelsSelected
                  ? t('providers.deselectAllModels')
                  : t('providers.selectAllModels')
              }
              icon={allCatalogModelsSelected ? <Minus size={15} /> : <Plus size={15} />}
              onClick={toggleCatalogSelection}
            />
          </header>
        </section>
        {groups.length === 0 ? (
          <div className={styles.providerModelsEmpty}>{t('providers.noCatalogModels')}</div>
        ) : (
          groups.map(([group, models]) => {
            const expanded = !collapsedGroups.has(group) || terms.length > 0
            const allSelected = models.every((model) => selected.has(model.modelId))
            const limit = visibleLimits[group] ?? 60
            const visibleModels = expanded ? models.slice(0, limit) : []
            return (
              <section className={styles.catalogGroup} key={group}>
                <header>
                  <button type="button" onClick={() => toggleExpanded(group)}>
                    <ChevronRight className={expanded ? styles.expandedChevron : ''} size={16} />
                    <strong>{group}</strong>
                    <span>{models.length}</span>
                  </button>
                  <Button
                    type="text"
                    size="small"
                    aria-label={allSelected ? t('providers.removeGroup') : t('providers.addGroup')}
                    icon={allSelected ? <Minus size={15} /> : <Plus size={15} />}
                    onClick={() => toggleGroup(models)}
                  />
                </header>
                {visibleModels.map((model) => {
                  const added = selected.has(model.modelId)
                  return (
                    <article
                      className={added ? styles.catalogModelSelected : ''}
                      key={model.modelId}
                    >
                      <div>
                        <strong>{model.name}</strong>
                        <small>{model.modelId}</small>
                      </div>
                      {renderCapabilities(model)}
                      <Button
                        type="text"
                        size="small"
                        aria-label={added ? t('providers.removeModel') : t('providers.addModel')}
                        icon={added ? <Minus size={15} /> : <Plus size={15} />}
                        onClick={() => toggleModel(model.modelId)}
                      />
                    </article>
                  )
                })}
                {expanded && models.length > limit && (
                  <Button type="link" block onClick={() => showMore(group)}>
                    {t('providers.showMore', { count: Math.min(100, models.length - limit) })}
                  </Button>
                )}
              </section>
            )
          })
        )}
      </div>
    </Modal>
  )
}

export default ProviderModelCatalogModal
