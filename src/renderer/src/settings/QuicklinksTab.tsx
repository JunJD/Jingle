import { useEffect, useEffectEvent, useState } from "react"
import { Link2, Save, Trash2 } from "lucide-react"
import type { ExtensionQuicklinkRecord } from "@shared/extension-quicklinks"
import { parseExtensionQuicklinkCommandUrl } from "@shared/extension-quicklinks"
import type { AppLocale } from "@shared/i18n"
import { getSettingsCopy } from "./copy"
import {
  secondaryButtonClassName,
  settingsCardClassName,
  settingsInsetCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName,
  SettingsField,
  SettingsTextInput
} from "./settings-ui"

function formatQuicklinkShortcut(quicklink: ExtensionQuicklinkRecord, emptyLabel: string): string {
  if (!quicklink.shortcut) {
    return emptyLabel
  }

  return [...quicklink.shortcut.modifiers, quicklink.shortcut.key].join(" + ")
}

function getQuicklinkKindLabel(quicklink: ExtensionQuicklinkRecord, commandLabel: string): string {
  const parsed = parseExtensionQuicklinkCommandUrl(quicklink.link)
  if (parsed) {
    return `${commandLabel} · ${parsed.extensionName}/${parsed.commandName}`
  }

  try {
    return quicklink.extensionName ?? new URL(quicklink.link).protocol.replace(":", "")
  } catch {
    return quicklink.extensionName ?? quicklink.link
  }
}

function QuicklinkCard(props: {
  copy: ReturnType<typeof getSettingsCopy>
  onRemove: (quicklinkId: string) => void
  onRename: (quicklinkId: string, name: string) => void
  quicklink: ExtensionQuicklinkRecord
}): React.JSX.Element {
  const { copy, onRemove, onRename, quicklink } = props
  const [name, setName] = useState(quicklink.name)

  return (
    <div
      className={`${settingsCardClassName} px-[var(--jingle-settings-card-x)] py-[var(--jingle-settings-card-y)]`}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--jingle-gap-md)]">
        <div className="min-w-0 space-y-[var(--jingle-space-1)]">
          <div className="flex items-center gap-[var(--jingle-gap-sm)]">
            <Link2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] text-muted-foreground" />
            <span className="[font-size:var(--jingle-font-label)] font-semibold text-foreground">
              {quicklink.name}
            </span>
          </div>
          <div className="[font-size:var(--jingle-font-body)] text-muted-foreground">
            {getQuicklinkKindLabel(quicklink, copy.quicklinks.commandLink)}
          </div>
        </div>
        <button
          type="button"
          className={secondaryButtonClassName}
          onClick={() => onRemove(quicklink.id)}
        >
          <Trash2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
          {copy.quicklinks.remove}
        </button>
      </div>

      <div className="mt-[var(--jingle-space-4)] grid gap-[var(--jingle-space-3)]">
        <SettingsField label={copy.quicklinks.name}>
          <div className="flex min-w-0 gap-[var(--jingle-gap-sm)]">
            <SettingsTextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={name.trim() === quicklink.name}
              onClick={() => onRename(quicklink.id, name)}
            >
              <Save className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
              {copy.quicklinks.save}
            </button>
          </div>
        </SettingsField>
        <SettingsField label={copy.quicklinks.link}>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] font-mono [font-size:var(--jingle-font-meta)] text-muted-foreground">
            {quicklink.link}
          </div>
        </SettingsField>
        <SettingsField label={copy.quicklinks.shortcut}>
          <div className="rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)] text-muted-foreground">
            {formatQuicklinkShortcut(quicklink, copy.common.none)}
          </div>
        </SettingsField>
      </div>
    </div>
  )
}

export function QuicklinksTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const [quicklinks, setQuicklinks] = useState<ExtensionQuicklinkRecord[]>([])

  const loadQuicklinks = useEffectEvent(async (signal: AbortSignal): Promise<void> => {
    const nextQuicklinks = await window.api.extensionQuicklinks.list()
    if (!signal.aborted) {
      setQuicklinks(nextQuicklinks)
    }
  })

  useEffect(() => {
    const controller = new AbortController()
    void loadQuicklinks(controller.signal)
    return () => {
      controller.abort()
    }
  }, [])

  const removeQuicklink = async (quicklinkId: string): Promise<void> => {
    await window.api.extensionQuicklinks.remove(quicklinkId)
    setQuicklinks((current) => current.filter((quicklink) => quicklink.id !== quicklinkId))
  }

  const renameQuicklink = async (quicklinkId: string, name: string): Promise<void> => {
    const updatedQuicklink = await window.api.extensionQuicklinks.update(quicklinkId, { name })
    setQuicklinks((current) =>
      current.map((quicklink) =>
        quicklink.id === updatedQuicklink.id ? updatedQuicklink : quicklink
      )
    )
  }

  return (
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <h2 className={settingsPageTitleClassName}>{copy.quicklinks.title}</h2>
        <div className={settingsPageDescriptionClassName}>{copy.quicklinks.description}</div>
      </div>

      <div className="grid gap-[var(--jingle-space-3)]">
        {quicklinks.length === 0 ? (
          <div
            className={`${settingsInsetCardClassName} border-dashed [font-size:var(--jingle-font-body)] text-muted-foreground`}
          >
            {copy.quicklinks.empty}
          </div>
        ) : (
          quicklinks.map((quicklink) => (
            <QuicklinkCard
              copy={copy}
              key={`${quicklink.id}:${quicklink.updatedAt}`}
              onRemove={(quicklinkId) => {
                void removeQuicklink(quicklinkId)
              }}
              onRename={(quicklinkId, name) => {
                void renameQuicklink(quicklinkId, name)
              }}
              quicklink={quicklink}
            />
          ))
        )}
      </div>
    </div>
  )
}
