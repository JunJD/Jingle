import { useEffect, useState } from "react"
import {
  Archive,
  Brain,
  Check,
  Database,
  FileText,
  Plus,
  RotateCcw,
  X,
  type LucideIcon
} from "lucide-react"
import type {
  JingleContextSourceRecord,
  JingleMemoryRecord,
  JingleMemoryScope,
  JingleMemorySettings,
  JingleMemorySuggestionRecord,
  JingleMemoryType,
  JingleWorkspaceIdentity
} from "@shared/jingle-memory"
import type { AppLocale } from "@shared/i18n"
import { formatRelativeTime } from "@/lib/utils"
import { getSettingsCopy } from "./copy"
import {
  inputClassName,
  secondaryButtonClassName,
  settingsCardClassName,
  settingsInsetCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch
} from "./settings-ui"

interface MemoryTabState {
  activeMemories: JingleMemoryRecord[]
  archivedMemories: JingleMemoryRecord[]
  contextSources: JingleContextSourceRecord[]
  settings: JingleMemorySettings
  suggestions: JingleMemorySuggestionRecord[]
  workspaceIdentity: JingleWorkspaceIdentity | null
}

async function readMemoryTabState(): Promise<MemoryTabState> {
  const [settings, workspaceIdentity, activeMemories, archivedMemories, suggestions, contextSources] =
    await Promise.all([
      window.api.memory.getSettings(),
      window.api.memory.getCurrentWorkspaceIdentity(),
      window.api.memory.listMemories({
        status: "active"
      }),
      window.api.memory.listMemories({
        status: "archived"
      }),
      window.api.memory.listSuggestions({
        status: "pending"
      }),
      window.api.memory.listContextSources()
    ])

  return {
    activeMemories,
    archivedMemories,
    contextSources,
    settings,
    suggestions,
    workspaceIdentity
  }
}

interface MemoryDraft {
  content: string
  scope: JingleMemoryScope
  type: JingleMemoryType
}

const DEFAULT_DRAFT: MemoryDraft = {
  content: "",
  scope: "global",
  type: "about_me"
}

function getTypeLabel(type: JingleMemoryType, copy: ReturnType<typeof getSettingsCopy>): string {
  switch (type) {
    case "about_me":
      return copy.memory.aboutMe
    case "workspace_context":
      return copy.memory.workspaceContext
    case "correction":
      return copy.memory.correction
  }
}

function getScopeLabel(
  scope: JingleMemoryScope,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  if (scope === "workspace") {
    return copy.memory.workspace
  }

  return copy.memory.global
}

function getMemoryToggleStatusLabel(enabled: boolean, copy: ReturnType<typeof getSettingsCopy>): string {
  if (enabled) {
    return copy.extensions.enabled
  }

  return copy.extensions.disabled
}

function getMemorySourceLabel(
  memory: JingleMemoryRecord,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  if (memory.source === "user") {
    return copy.memory.add
  }

  return copy.memory.accept
}

function getContextSourceStatusLabel(
  source: JingleContextSourceRecord,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  if (source.error) {
    return copy.common.error
  }
  if (source.exists) {
    return copy.memory.savedStatus
  }

  return copy.common.none
}

function SectionHeader(props: { count?: number; title: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-[var(--jingle-gap-md)]">
      <div className="[font-size:var(--jingle-font-label)] font-semibold text-foreground">
        {props.title}
      </div>
      {typeof props.count === "number" ? (
        <span className="[font-size:var(--jingle-font-meta)] text-muted-foreground">{props.count}</span>
      ) : null}
    </div>
  )
}

function MemoryBadge(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex min-h-[22px] items-center rounded-[var(--jingle-radius-sm)] border border-border bg-background px-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] text-muted-foreground">
      {props.children}
    </span>
  )
}

type SettingsCopy = ReturnType<typeof getSettingsCopy>

function MemorySettingsCard(props: {
  copy: SettingsCopy
  settings: JingleMemorySettings
  updateSettings: (updates: Partial<JingleMemorySettings>) => Promise<void>
}): React.JSX.Element {
  const { copy, settings, updateSettings } = props

  return (
    <div className={settingsCardClassName}>
      <SettingsRow
        icon={<Brain className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />}
        title={copy.memory.useMemory}
        description={copy.memory.useMemoryDescription}
      >
        <div className="flex min-h-[var(--jingle-settings-control-h)] items-center justify-between gap-[var(--jingle-gap-md)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)]">
          <span className="[font-size:var(--jingle-settings-control-font)] text-muted-foreground">
            {getMemoryToggleStatusLabel(settings.useMemory, copy)}
          </span>
          <SettingsSwitch
            checked={settings.useMemory}
            label={copy.memory.useMemory}
            onCheckedChange={(checked) => {
              void updateSettings({ useMemory: checked })
            }}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        icon={<Check className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />}
        title={copy.memory.askBeforeSaving}
        description={copy.memory.askBeforeSavingDescription}
      >
        <div className="flex min-h-[var(--jingle-settings-control-h)] items-center justify-between gap-[var(--jingle-gap-md)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)]">
          <span className="[font-size:var(--jingle-settings-control-font)] text-muted-foreground">
            {copy.extensions.enabled}
          </span>
          <SettingsSwitch
            checked={settings.askBeforeSaving}
            disabled
            label={copy.memory.askBeforeSaving}
            onCheckedChange={() => {}}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        icon={<Database className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />}
        title={copy.memory.showIncludedMemories}
        description={copy.memory.showIncludedMemoriesDescription}
        withBorder={false}
      >
        <div className="flex min-h-[var(--jingle-settings-control-h)] items-center justify-between gap-[var(--jingle-gap-md)] rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)]">
          <span className="[font-size:var(--jingle-settings-control-font)] text-muted-foreground">
            {getMemoryToggleStatusLabel(settings.showIncludedMemories, copy)}
          </span>
          <SettingsSwitch
            checked={settings.showIncludedMemories}
            label={copy.memory.showIncludedMemories}
            onCheckedChange={(checked) => {
              void updateSettings({ showIncludedMemories: checked })
            }}
          />
        </div>
      </SettingsRow>
    </div>
  )
}

function NewMemoryCard(props: {
  copy: SettingsCopy
  draft: MemoryDraft
  onCreateMemory: () => Promise<void>
  onDraftChange: (draft: MemoryDraft) => void
  status: string
}): React.JSX.Element {
  const { copy, draft, onCreateMemory, onDraftChange, status } = props

  return (
    <div className={settingsCardClassName}>
      <div className="border-b border-border/70 px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        <SectionHeader title={copy.memory.add} />
      </div>
      <div className="grid gap-[var(--jingle-space-3)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        <textarea
          aria-label={copy.memory.content}
          className={`${inputClassName} min-h-[var(--jingle-settings-textarea-min-h)] resize-y`}
          placeholder={copy.memory.content}
          value={draft.content}
          onChange={(event) => {
            onDraftChange({ ...draft, content: event.target.value })
          }}
        />
        <div className="flex flex-wrap items-center gap-[var(--jingle-gap-md)]">
          <SettingsSelect
            aria-label={copy.memory.typeLabel}
            className="max-w-[var(--jingle-settings-select-w)]"
            value={draft.type}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                type: event.target.value as JingleMemoryType
              })
            }}
          >
            <option value="about_me">{copy.memory.aboutMe}</option>
            <option value="workspace_context">{copy.memory.workspaceContext}</option>
            <option value="correction">{copy.memory.correction}</option>
          </SettingsSelect>
          <SettingsSelect
            aria-label={copy.memory.scopeLabel}
            className="max-w-[var(--jingle-settings-select-w)]"
            value={draft.scope}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                scope: event.target.value as JingleMemoryScope
              })
            }}
          >
            <option value="global">{copy.memory.global}</option>
            <option value="workspace">{copy.memory.workspace}</option>
          </SettingsSelect>
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={!draft.content.trim()}
            onClick={() => {
              void onCreateMemory()
            }}
          >
            <Plus className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
            {copy.memory.add}
          </button>
          {status ? (
            <span className="[font-size:var(--jingle-font-body)] text-muted-foreground">
              {status}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PendingSuggestionsCard(props: {
  copy: SettingsCopy
  locale: AppLocale
  onAcceptSuggestion: (suggestion: JingleMemorySuggestionRecord) => Promise<void>
  onRejectSuggestion: (suggestion: JingleMemorySuggestionRecord) => Promise<void>
  suggestions: JingleMemorySuggestionRecord[]
}): React.JSX.Element {
  const { copy, locale, onAcceptSuggestion, onRejectSuggestion, suggestions } = props

  return (
    <div className={settingsCardClassName}>
      <div className="border-b border-border/70 px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        <SectionHeader title={copy.memory.pendingSuggestions} count={suggestions.length} />
      </div>
      <div className="grid gap-[var(--jingle-space-3)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        {suggestions.length === 0 ? (
          <div className={`${settingsInsetCardClassName} border-dashed text-muted-foreground`}>
            {copy.memory.emptySuggestions}
          </div>
        ) : (
          suggestions.map((suggestion) => (
            <div key={suggestion.suggestionId} className={settingsInsetCardClassName}>
              <div className="[font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-foreground">
                {suggestion.content}
              </div>
              <div className="mt-[var(--jingle-space-2)] flex flex-wrap items-center gap-[var(--jingle-gap-sm)]">
                <MemoryBadge>{getTypeLabel(suggestion.type, copy)}</MemoryBadge>
                <MemoryBadge>{getScopeLabel(suggestion.scope, copy)}</MemoryBadge>
                <MemoryBadge>
                  {formatRelativeTime(new Date(suggestion.createdAt), locale)}
                </MemoryBadge>
              </div>
              {suggestion.reason ? (
                <div className="mt-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
                  {suggestion.reason}
                </div>
              ) : null}
              <div className="mt-[var(--jingle-space-3)] flex items-center gap-[var(--jingle-gap-sm)]">
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => {
                    void onAcceptSuggestion(suggestion)
                  }}
                >
                  <Check className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
                  {copy.memory.accept}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => {
                    void onRejectSuggestion(suggestion)
                  }}
                >
                  <X className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
                  {copy.memory.reject}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function MemoriesCard(props: {
  actionIcon: LucideIcon
  actionLabel: string
  copy: SettingsCopy
  emptyLabel: string
  memories: JingleMemoryRecord[]
  onAction: (memory: JingleMemoryRecord) => Promise<void>
  title: string
}): React.JSX.Element {
  const {
    actionIcon: ActionIcon,
    actionLabel,
    copy,
    emptyLabel,
    memories,
    onAction,
    title
  } = props

  return (
    <div className={settingsCardClassName}>
      <div className="border-b border-border/70 px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        <SectionHeader title={title} count={memories.length} />
      </div>
      <div className="grid gap-[var(--jingle-space-3)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        {memories.length === 0 ? (
          <div className={`${settingsInsetCardClassName} border-dashed text-muted-foreground`}>
            {emptyLabel}
          </div>
        ) : (
          memories.map((memory) => (
            <div key={memory.memoryId} className={settingsInsetCardClassName}>
              <div className="[font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-foreground">
                {memory.content}
              </div>
              <div className="mt-[var(--jingle-space-2)] flex flex-wrap items-center gap-[var(--jingle-gap-sm)]">
                <MemoryBadge>{getTypeLabel(memory.type, copy)}</MemoryBadge>
                <MemoryBadge>{getScopeLabel(memory.scope, copy)}</MemoryBadge>
                <MemoryBadge>{getMemorySourceLabel(memory, copy)}</MemoryBadge>
              </div>
              <div className="mt-[var(--jingle-space-3)] flex items-center gap-[var(--jingle-gap-sm)]">
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => {
                    void onAction(memory)
                  }}
                >
                  <ActionIcon className="h-4 w-4" />
                  {actionLabel}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ContextSourcesCard(props: {
  contextSources: JingleContextSourceRecord[]
  copy: SettingsCopy
}): React.JSX.Element | null {
  const { contextSources, copy } = props

  if (contextSources.length === 0) {
    return null
  }

  return (
    <div className={settingsCardClassName}>
      <div className="border-b border-border/70 px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        <SectionHeader title={copy.memory.contextSources} count={contextSources.length} />
      </div>
      <div className="grid gap-[var(--jingle-space-2)] px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]">
        {contextSources.map((source) => (
          <div
            key={source.id}
            className="flex min-w-0 items-center gap-[var(--jingle-gap-md)] rounded-[var(--jingle-radius-md)] border border-border/70 bg-background px-[var(--jingle-space-3)] py-[var(--jingle-space-2)]"
          >
            <FileText className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="[font-size:var(--jingle-font-body)] font-medium text-foreground">
                {source.sourceLabel}
              </div>
              <div className="truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
                {source.path}
              </div>
            </div>
            <MemoryBadge>
              {getContextSourceStatusLabel(source, copy)}
            </MemoryBadge>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MemoryTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const [draft, setDraft] = useState<MemoryDraft>(DEFAULT_DRAFT)
  const [state, setState] = useState<MemoryTabState | null>(null)
  const [status, setStatus] = useState("")

  const loadMemory = async (): Promise<void> => {
    setState(await readMemoryTabState())
  }

  useEffect(() => {
    let isCurrent = true

    void readMemoryTabState().then((nextState) => {
      if (isCurrent) {
        setState(nextState)
      }
    })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    if (!status) {
      return
    }

    const timeoutId = window.setTimeout(() => setStatus(""), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [status])

  const flashSaved = (): void => {
    setStatus(copy.memory.savedStatus)
  }

  const updateSettings = async (updates: Partial<JingleMemorySettings>): Promise<void> => {
    const settings = await window.api.memory.setSettings(updates)
    setState((current) => (current ? { ...current, settings } : current))
    flashSaved()
  }

  const createMemory = async (): Promise<void> => {
    const content = draft.content.trim()
    if (!content || !state) {
      return
    }

    await window.api.memory.createMemory({
      content,
      scope: draft.scope,
      type: draft.type
    })
    setDraft(DEFAULT_DRAFT)
    await loadMemory()
    flashSaved()
  }

  const acceptSuggestion = async (suggestion: JingleMemorySuggestionRecord): Promise<void> => {
    await window.api.memory.acceptSuggestion(suggestion.suggestionId)
    await loadMemory()
    flashSaved()
  }

  const rejectSuggestion = async (suggestion: JingleMemorySuggestionRecord): Promise<void> => {
    await window.api.memory.rejectSuggestion(suggestion.suggestionId)
    await loadMemory()
  }

  const archiveMemory = async (memory: JingleMemoryRecord): Promise<void> => {
    await window.api.memory.archiveMemory(memory.memoryId)
    await loadMemory()
  }

  const restoreMemory = async (memory: JingleMemoryRecord): Promise<void> => {
    await window.api.memory.restoreMemory(memory.memoryId)
    await loadMemory()
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--jingle-font-label)] text-muted-foreground">
        {copy.memory.loading}
      </div>
    )
  }

  return (
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <div className={settingsPageTitleClassName}>{copy.memory.title}</div>
        <div className={settingsPageDescriptionClassName}>{copy.memory.description}</div>
      </div>

      <MemorySettingsCard copy={copy} settings={state.settings} updateSettings={updateSettings} />
      <NewMemoryCard
        copy={copy}
        draft={draft}
        onCreateMemory={createMemory}
        onDraftChange={setDraft}
        status={status}
      />
      <PendingSuggestionsCard
        copy={copy}
        locale={locale}
        onAcceptSuggestion={acceptSuggestion}
        onRejectSuggestion={rejectSuggestion}
        suggestions={state.suggestions}
      />
      <MemoriesCard
        actionIcon={Archive}
        actionLabel={copy.memory.archive}
        copy={copy}
        emptyLabel={copy.memory.emptyMemories}
        memories={state.activeMemories}
        onAction={archiveMemory}
        title={copy.memory.savedMemories}
      />
      <MemoriesCard
        actionIcon={RotateCcw}
        actionLabel={copy.memory.restore}
        copy={copy}
        emptyLabel={copy.memory.emptyArchivedMemories}
        memories={state.archivedMemories}
        onAction={restoreMemory}
        title={copy.memory.archivedMemories}
      />
      <ContextSourcesCard contextSources={state.contextSources} copy={copy} />
    </div>
  )
}
