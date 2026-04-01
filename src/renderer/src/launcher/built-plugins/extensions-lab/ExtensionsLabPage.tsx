import { useEffect, useMemo, useState } from "react"
import type { ExternalExtensionCommandInfo } from "../../../../../shared/external-extensions"
import { useBuiltLauncherPluginNavigation } from "../sdk"

function compareCommands(
  left: ExternalExtensionCommandInfo,
  right: ExternalExtensionCommandInfo
): number {
  const extensionTitleOrder = left.extensionTitle.localeCompare(right.extensionTitle)
  if (extensionTitleOrder !== 0) {
    return extensionTitleOrder
  }

  return left.title.localeCompare(right.title)
}

export function ExtensionsLabPage(): React.JSX.Element {
  const navigation = useBuiltLauncherPluginNavigation()
  const [commands, setCommands] = useState<ExternalExtensionCommandInfo[]>([])
  const [commandsLoading, setCommandsLoading] = useState(true)
  const [commandsError, setCommandsError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const nextCommands = await window.api.extensions.listCommands()
        if (cancelled) {
          return
        }

        setCommands([...nextCommands].sort(compareCommands))
        setCommandsError(null)
      } catch (error) {
        if (cancelled) {
          return
        }

        setCommandsError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled) {
          setCommandsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredCommands = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()
    if (!normalizedFilter) {
      return commands
    }

    return commands.filter((command) => {
      return (
        command.extensionTitle.toLowerCase().includes(normalizedFilter) ||
        command.extensionName.toLowerCase().includes(normalizedFilter) ||
        command.title.toLowerCase().includes(normalizedFilter) ||
        command.commandName.toLowerCase().includes(normalizedFilter) ||
        command.description.toLowerCase().includes(normalizedFilter)
      )
    })
  }, [commands, filter])

  return (
    <div className="flex h-full flex-col bg-[var(--launcher-surface)] text-[var(--launcher-text)]">
      <div className="border-b border-[var(--launcher-border)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--launcher-text-muted)]">
              External Runtime
            </div>
            <div className="mt-1 text-lg font-semibold">Extensions Lab</div>
            <div className="mt-1 text-sm text-[var(--launcher-text-muted)]">
              Bundle and run vendored Raycast-style commands inside Openwork.
            </div>
          </div>
          <button
            className="rounded-full border border-[var(--launcher-border)] px-3 py-1.5 text-sm text-[var(--launcher-text-muted)] transition hover:text-[var(--launcher-text)]"
            onClick={() => navigation.goHome()}
            type="button"
          >
            Close
          </button>
        </div>
        <input
          className="mt-4 w-full rounded-2xl border border-[var(--launcher-border)] bg-[var(--launcher-surface-strong)] px-4 py-3 text-sm outline-none placeholder:text-[var(--launcher-text-muted)]"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter extension commands"
          value={filter}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {commandsLoading ? (
          <div className="rounded-3xl border border-dashed border-[var(--launcher-border)] px-4 py-6 text-sm text-[var(--launcher-text-muted)]">
            Loading external extensions...
          </div>
        ) : commandsError ? (
          <div className="rounded-3xl border border-[var(--launcher-border)] bg-[rgba(160,32,32,0.08)] px-4 py-6 text-sm text-[#cf9d9d]">
            {commandsError}
          </div>
        ) : filteredCommands.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--launcher-border)] px-4 py-6 text-sm text-[var(--launcher-text-muted)]">
            No external commands matched.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCommands.map((command) => {
              return (
                <button
                  className="flex w-full items-start justify-between gap-4 rounded-3xl border border-[var(--launcher-border)] bg-[var(--launcher-surface-strong)] px-4 py-4 text-left transition hover:border-[var(--launcher-border-strong)] hover:bg-[var(--launcher-surface-hover)]"
                  key={command.id}
                  onClick={() => {
                    navigation.openCommand({
                      kind: "external-extension",
                      commandName: command.commandName,
                      extensionName: command.extensionName
                    })
                  }}
                  type="button"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{command.title}</span>
                      <span className="rounded-full border border-[var(--launcher-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--launcher-text-muted)]">
                        {command.mode}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--launcher-text-muted)]">
                      {command.extensionTitle} · {command.extensionName}/{command.commandName}
                    </div>
                    <div className="mt-2 text-sm text-[var(--launcher-text-muted)]">
                      {command.description}
                    </div>
                    {command.commandArgumentDefinitions.length > 0 ? (
                      <div className="mt-2 text-xs text-[var(--launcher-text-muted)]">
                        Args:{" "}
                        {command.commandArgumentDefinitions
                          .map((definition) => definition.name)
                          .join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-xs text-[var(--launcher-text-muted)]">Open</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
