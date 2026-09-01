import { useDeferredValue, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Search, Settings2, X } from 'lucide-react'
import type { ModelCatalog, Provider } from '../types'

type ModelPickerProps = {
  models: ModelCatalog | null
  onOpenAuth: () => void
  onPickModel: (provider: string, model: string) => void
}

type ModelResult = {
  model: string
  provider: Provider
}

function ProviderRail({
  providers,
  currentProviderId,
  searchActive,
  onSelect,
}: {
  providers: Provider[]
  currentProviderId: string
  searchActive: boolean
  onSelect: (providerId: string) => void
}) {
  return (
    <aside className="modelProviderPane" aria-label="Model providers">
      <div className="modelPickerSectionLabel">
        <span>Providers</span>
        <span>{providers.length}</span>
      </div>
      <div className="modelProviderRail">
        {providers.map(provider => {
          const isSelected = provider.id === currentProviderId && !searchActive
          return (
            <button
              key={provider.id}
              type="button"
              className={`modelProviderOption ${isSelected ? 'active' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(provider.id)}
            >
              <span className={`modelProviderStatus ${provider.configured ? 'configured' : ''}`} aria-hidden="true" />
              <span className="modelProviderName">{provider.name}</span>
              <small>{provider.models.length}</small>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function ModelResultsPane({
  catalog,
  activeProvider,
  search,
  results,
  onClearSearch,
  onSelect,
}: {
  catalog: ModelCatalog
  activeProvider: Provider | undefined
  search: string
  results: ModelResult[]
  onClearSearch: () => void
  onSelect: (providerId: string, model: string) => void
}) {
  const visibleResults = results.slice(0, 120)

  return (
    <section className="modelResultsPane" aria-live="polite">
      <div className="modelResultsHeader">
        <div>
          <strong>{search ? 'Search results' : activeProvider?.name ?? 'Models'}</strong>
          <span>
            {search
              ? `${results.length} ${results.length === 1 ? 'match' : 'matches'} across all providers`
              : activeProvider?.configured
                ? 'Ready to use'
                : 'Provider setup may be required'}
          </span>
        </div>
        {!search && activeProvider ? (
          <span className={`modelProviderBadge ${activeProvider.configured ? 'configured' : ''}`}>
            {activeProvider.configured ? 'Configured' : 'Not configured'}
          </span>
        ) : null}
      </div>

      <div className="modelResultList" role="group" aria-label="Available models">
        {visibleResults.map(({ model, provider }) => {
          const isActive = catalog.active_model === model && catalog.active_provider === provider.id
          return (
            <button
              key={`${provider.id}:${model}`}
              type="button"
              className={`modelResult ${isActive ? 'active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onSelect(provider.id, model)}
            >
              <span className="modelResultCopy">
                <strong>{model}</strong>
                <small>{provider.name}{provider.configured ? '' : ' · setup may be required'}</small>
              </span>
              {isActive ? (
                <span className="modelCurrentBadge">
                  <Check size={12} aria-hidden="true" />
                  Current
                </span>
              ) : (
                <span className="modelSelectHint">Select</span>
              )}
            </button>
          )
        })}

        {results.length === 0 ? (
          <div className="modelEmptyState">
            <Search size={18} aria-hidden="true" />
            <strong>No models found</strong>
            <span>Try a model family or provider name.</span>
            {search ? <button type="button" onClick={onClearSearch}>Clear search</button> : null}
          </div>
        ) : null}

        {results.length > visibleResults.length ? (
          <div className="modelResultLimit">
            Showing the first {visibleResults.length} results. Refine your search to narrow the list.
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function ModelPicker({ models, onOpenAuth, onPickModel }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const deferredSearch = useDeferredValue(search)
  const currentProviderId = selectedProviderId ?? models?.active_provider ?? models?.providers[0]?.id ?? 'anthropic'
  const activeProvider = models?.providers.find(provider => provider.id === currentProviderId) ?? models?.providers[0]
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase()

  const providers = useMemo(() => {
    if (!models) return []
    const sorted = [...models.providers]
    sorted.sort((a, b) => {
      const aIsActive = a.id === models.active_provider
      const bIsActive = b.id === models.active_provider
      if (aIsActive !== bIsActive) return aIsActive ? -1 : 1
      if (a.configured !== b.configured) return a.configured ? -1 : 1
      return 0
    })
    return sorted
  }, [models])

  const results = useMemo(() => {
    if (!models) return []
    const candidateProviders = normalizedSearch ? models.providers : activeProvider ? [activeProvider] : []
    const matches: ModelResult[] = []

    for (const provider of candidateProviders) {
      for (const model of provider.models) {
        const searchText = `${model} ${provider.name} ${provider.id}`.toLocaleLowerCase()
        if (!normalizedSearch || searchText.includes(normalizedSearch)) matches.push({ model, provider })
      }
    }

    matches.sort((a, b) => {
      const aIsActive = a.model === models.active_model && a.provider.id === models.active_provider
      const bIsActive = b.model === models.active_model && b.provider.id === models.active_provider
      if (aIsActive === bIsActive) return 0
      return aIsActive ? -1 : 1
    })
    return matches
  }, [activeProvider, models, normalizedSearch])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setSelectedProviderId(models?.active_provider ?? models?.providers[0]?.id ?? null)
      setSearch('')
    }
  }

  const handleSelectModel = (providerId: string, model: string) => {
    onPickModel(providerId, model)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          className="modelButton"
          type="button"
          aria-label={`Model selector, current model ${models?.active_model ?? 'not selected'}`}
        >
          <span className="modelButtonSignal" aria-hidden="true" />
          <span className="modelButtonCopy">
            <strong>{models?.active_model ?? 'Select a model'}</strong>
            <small>{models?.providers.find(provider => provider.id === models.active_provider)?.name ?? models?.active_provider ?? 'Provider'}</small>
          </span>
          <ChevronDown className="modelButtonChevron" size={13} aria-hidden="true" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="modelPopover modelPicker"
          sideOffset={8}
          align="end"
          collisionPadding={10}
          aria-label="Model selector"
          onOpenAutoFocus={event => {
            event.preventDefault()
            searchRef.current?.focus()
          }}
        >
          {models?.providers && models.providers.length > 0 ? (
            <>
              <div className="modelPickerHeader">
                <div>
                  <span className="modelPickerKicker">Runtime</span>
                  <strong>Choose a model</strong>
                </div>
                <button
                  type="button"
                  className="modelPickerManage"
                  onClick={() => {
                    setOpen(false)
                    onOpenAuth()
                  }}
                >
                  <Settings2 size={13} aria-hidden="true" />
                  Manage providers
                </button>
              </div>

              <label className="modelSearchField">
                <Search size={14} aria-hidden="true" />
                <span className="sr-only">Search models and providers</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search models or providers…"
                  autoComplete="off"
                />
                {search ? (
                  <button type="button" onClick={() => setSearch('')} aria-label="Clear model search">
                    <X size={13} aria-hidden="true" />
                  </button>
                ) : (
                  <kbd>/</kbd>
                )}
              </label>

              <div className="modelPickerBody">
                <ProviderRail
                  providers={providers}
                  currentProviderId={currentProviderId}
                  searchActive={Boolean(search)}
                  onSelect={providerId => {
                    setSelectedProviderId(providerId)
                    setSearch('')
                  }}
                />
                <ModelResultsPane
                  catalog={models}
                  activeProvider={activeProvider}
                  search={search}
                  results={results}
                  onClearSearch={() => setSearch('')}
                  onSelect={handleSelectModel}
                />
              </div>

              <div className="modelPickerFooter">
                <span><kbd>Tab</kbd> navigate</span>
                <span><kbd>Enter</kbd> select</span>
                <span><kbd>Esc</kbd> close</span>
              </div>
            </>
          ) : (
            <div className="modelPickerLoading">
              <span className="modelPickerSpinner" aria-hidden="true" />
              <div>
                <strong>Connecting to the model registry</strong>
                <small>Available models will appear here.</small>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
