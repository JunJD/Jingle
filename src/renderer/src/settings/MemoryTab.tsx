import { useEffect, useState } from "react"
import { Brain, Check, Database, FileText, Plus, Trash2, X } from "lucide-react"
import type {
  OpenworkContextSourceRecord,
  OpenworkMemoryRecord,
  OpenworkMemoryScope,
  OpenworkMemorySettings,
  OpenworkMemorySuggestionRecord,
  OpenworkMemoryType,
  OpenworkWorkspaceIdentity
} from "@shared/openwork-memory"
import type { AppLocale } from "@shared/i18n"
import { formatRelativeTime } from "@/lib/utils"
import { getSettingsCopy } from "./copy"
import {
  inputClassName,
  secondaryButtonClassName,
  selectClassName,
  settingsCardClassName,
  settingsInsetCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName,
  SettingsRow,
  SettingsSwitch
} from "./settings-ui"

interface MemoryTabState {
  contextSources: OpenworkContextSourceRecord[]
  memories: OpenworkMemoryRecord[]
  settings: OpenworkMemorySettings
  suggestions: OpenworkMemorySuggestionRecord[]
  workspaceIdentity: OpenworkWorkspaceIdentity | null
}

interface MemoryDraft {
  content: string
  scope: OpenworkMemoryScope
  type: OpenworkMemoryType
}

const DEFAULT_DRAFT: MemoryDraft = {
  content: "",
  scope: "global",
  type: "about_me"
}

function getTypeLabel(type: OpenworkMemoryType, copy: ReturnType<typeof getSettingsCopy>): string {
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
  scope: OpenworkMemoryScope,
  copy: ReturnType<typeof getSettingsCopy>
): string {
  return scope === "workspace" ? copy.memory.workspace : copy.memory.global
}

function SectionHeader(props: { count?: number; title: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-[var(--ow-gap-md)]">
      <div className="[font-size:var(--ow-font-label)] font-semibold text-foreground">
        {props.title}
      </div>
      {typeof props.count === "number" ? (
        <span className="[font-size:var(--ow-font-meta)] text-muted-foreground">
          {props.count}
        </span>
      ) : null}
    </div>
  )
}

function MemoryBadge(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex min-h-[22px] items-center rounded-[var(--ow-radius-sm)] border border-border bg-background px-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-muted-foreground">
      {props.children}
    </span>
  )
}

export function MemoryTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const [draft, setDraft] = useState<MemoryDraft>(DEFAULT_DRAFT)
  const [state, setState] = useState<MemoryTabState | null>(null)
  const [status, setStatus] = useState("")

  const loadMemory = async (): Promise<void> => {
    const [settings, workspaceIdentity] = await Promise.all([
      window.api.memory.getSettings(),
      window.api.memory.getCurrentWorkspaceIdentity()
    ])
    const [memories, suggestions, contextSources] = await Promise.all([
      window.api.memory.listMemories({
        status: "active"
      }),
      window.api.memory.listSuggestions({
        status: "pending"
      }),
      window.api.memory.listContextSources()
    ])

    setState({
      contextSources,
      memories,
      settings,
      suggestions,
      workspaceIdentity
    })
  }

  useEffect(() => {
    void loadMemory()
  }, [])

  const flashSaved = (): void => {
    setStatus(copy.memory.savedStatus)
    window.setTimeout(() => setStatus(""), 1600)
  }

  const updateSettings = async (updates: Partial<OpenworkMemorySettings>): Promise<void> => {
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

  const acceptSuggestion = async (suggestion: OpenworkMemorySuggestionRecord): Promise<void> => {
    await window.api.memory.acceptSuggestion(suggestion.suggestionId)
    await loadMemory()
    flashSaved()
  }

  const rejectSuggestion = async (suggestion: OpenworkMemorySuggestionRecord): Promise<void> => {
    await window.api.memory.rejectSuggestion(suggestion.suggestionId)
    await loadMemory()
  }

  const archiveMemory = async (memory: OpenworkMemoryRecord): Promise<void> => {
    await window.api.memory.archiveMemory(memory.memoryId)
    await loadMemory()
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--ow-font-label)] text-muted-foreground">
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

      <div className={settingsCardClassName}>
        <SettingsRow
          icon={<Brain className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.memory.useMemory}
          description={copy.memory.useMemoryDescription}
        >
          <div className="flex min-h-[var(--ow-settings-control-h)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)]">
            <span className="[font-size:var(--ow-settings-control-font)] text-muted-foreground">
              {state.settings.useMemory ? copy.extensions.enabled : copy.extensions.disabled}
            </span>
            <SettingsSwitch
              checked={state.settings.useMemory}
              label={copy.memory.useMemory}
              onCheckedChange={(checked) => {
                void updateSettings({ useMemory: checked })
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Check className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.memory.askBeforeSaving}
          description={copy.memory.askBeforeSavingDescription}
        >
          <div className="flex min-h-[var(--ow-settings-control-h)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)]">
            <span className="[font-size:var(--ow-settings-control-font)] text-muted-foreground">
              {copy.extensions.enabled}
            </span>
            <SettingsSwitch
              checked={state.settings.askBeforeSaving}
              disabled
              label={copy.memory.askBeforeSaving}
              onCheckedChange={() => {}}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Database className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.memory.showIncludedMemories}
          description={copy.memory.showIncludedMemoriesDescription}
          withBorder={false}
        >
          <div className="flex min-h-[var(--ow-settings-control-h)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)]">
            <span className="[font-size:var(--ow-settings-control-font)] text-muted-foreground">
              {state.settings.showIncludedMemories
                ? copy.extensions.enabled
                : copy.extensions.disabled}
            </span>
            <SettingsSwitch
              checked={state.settings.showIncludedMemories}
              label={copy.memory.showIncludedMemories}
              onCheckedChange={(checked) => {
                void updateSettings({ showIncludedMemories: checked })
              }}
            />
          </div>
        </SettingsRow>
      </div>

      <div className={settingsCardClassName}>
        <div className="border-b border-border/70 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
          <SectionHeader title={copy.memory.add} />
        </div>
        <div className="grid gap-[var(--ow-space-3)] px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
          <textarea
            className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] resize-y`}
            placeholder={copy.memory.content}
            value={draft.content}
            onChange={(event) => {
              setDraft((current) => ({ ...current, content: event.target.value }))
            }}
          />
          <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
            <select
              className={`${selectClassName} max-w-[var(--ow-settings-select-w)]`}
              value={draft.type}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  type: event.target.value as OpenworkMemoryType
                }))
              }}
            >
              <option value="about_me">{copy.memory.aboutMe}</option>
              <option value="workspace_context">{copy.memory.workspaceContext}</option>
              <option value="correction">{copy.memory.correction}</option>
            </select>
            <select
              className={`${selectClassName} max-w-[var(--ow-settings-select-w)]`}
              value={draft.scope}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  scope: event.target.value as OpenworkMemoryScope
                }))
              }}
            >
              <option value="global">{copy.memory.global}</option>
              <option value="workspace">{copy.memory.workspace}</option>
            </select>
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={!draft.content.trim()}
              onClick={() => {
                void createMemory()
              }}
            >
              <Plus className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
              {copy.memory.add}
            </button>
            {status ? (
              <span className="[font-size:var(--ow-font-body)] text-muted-foreground">
                {status}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={settingsCardClassName}>
        <div className="border-b border-border/70 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
          <SectionHeader title={copy.memory.pendingSuggestions} count={state.suggestions.length} />
        </div>
        <div className="grid gap-[var(--ow-space-3)] px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
          {state.suggestions.length === 0 ? (
            <div className={`${settingsInsetCardClassName} border-dashed text-muted-foreground`}>
              {copy.memory.emptySuggestions}
            </div>
          ) : (
            state.suggestions.map((suggestion) => (
              <div key={suggestion.suggestionId} className={settingsInsetCardClassName}>
                <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-foreground">
                  {suggestion.content}
                </div>
                <div className="mt-[var(--ow-space-2)] flex flex-wrap items-center gap-[var(--ow-gap-sm)]">
                  <MemoryBadge>{getTypeLabel(suggestion.type, copy)}</MemoryBadge>
                  <MemoryBadge>{getScopeLabel(suggestion.scope, copy)}</MemoryBadge>
                  <MemoryBadge>
                    {formatRelativeTime(new Date(suggestion.createdAt), locale)}
                  </MemoryBadge>
                </div>
                {suggestion.reason ? (
                  <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
                    {suggestion.reason}
                  </div>
                ) : null}
                <div className="mt-[var(--ow-space-3)] flex items-center gap-[var(--ow-gap-sm)]">
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={() => {
                      void acceptSuggestion(suggestion)
                    }}
                  >
                    <Check className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
                    {copy.memory.accept}
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={() => {
                      void rejectSuggestion(suggestion)
                    }}
                  >
                    <X className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
                    {copy.memory.reject}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={settingsCardClassName}>
        <div className="border-b border-border/70 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
          <SectionHeader title={copy.memory.savedMemories} count={state.memories.length} />
        </div>
        <div className="grid gap-[var(--ow-space-3)] px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
          {state.memories.length === 0 ? (
            <div className={`${settingsInsetCardClassName} border-dashed text-muted-foreground`}>
              {copy.memory.emptyMemories}
            </div>
          ) : (
            state.memories.map((memory) => (
              <div key={memory.memoryId} className={settingsInsetCardClassName}>
                <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-foreground">
                  {memory.content}
                </div>
                <div className="mt-[var(--ow-space-2)] flex flex-wrap items-center gap-[var(--ow-gap-sm)]">
                  <MemoryBadge>{getTypeLabel(memory.type, copy)}</MemoryBadge>
                  <MemoryBadge>{getScopeLabel(memory.scope, copy)}</MemoryBadge>
                  <MemoryBadge>
                    {memory.source === "user" ? copy.memory.add : copy.memory.accept}
                  </MemoryBadge>
                </div>
                <div className="mt-[var(--ow-space-3)] flex items-center gap-[var(--ow-gap-sm)]">
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={() => {
                      void archiveMemory(memory)
                    }}
                  >
                    <Trash2 className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
                    {copy.memory.archive}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {state.contextSources.length > 0 ? (
        <div className={settingsCardClassName}>
          <div className="border-b border-border/70 px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
            <SectionHeader title={copy.memory.contextSources} count={state.contextSources.length} />
          </div>
          <div className="grid gap-[var(--ow-space-2)] px-[var(--ow-settings-card-x)] py-[var(--ow-settings-card-y)]">
            {state.contextSources.map((source) => (
              <div
                key={source.id}
                className="flex min-w-0 items-center gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border/70 bg-background px-[var(--ow-space-3)] py-[var(--ow-space-2)]"
              >
                <FileText className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="[font-size:var(--ow-font-body)] font-medium text-foreground">
                    {source.sourceLabel}
                  </div>
                  <div className="truncate [font-size:var(--ow-font-meta)] text-muted-foreground">
                    {source.path}
                  </div>
                </div>
                <MemoryBadge>
                  {source.error
                    ? copy.common.error
                    : source.exists
                      ? copy.memory.savedStatus
                      : copy.common.none}
                </MemoryBadge>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
