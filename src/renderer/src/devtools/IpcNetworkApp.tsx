import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  DevtoolsNetworkDirection,
  DevtoolsNetworkEntry,
  DevtoolsNetworkSource,
  DevtoolsNetworkStatus,
  DevtoolsNetworkValueSummary
} from "@jingle/devtools-network"
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./IpcNetworkApp.css"

const AUTO_REFRESH_INTERVAL_MS = 800

type StatusFilter = "all" | DevtoolsNetworkStatus
type DirectionFilter = "all" | DevtoolsNetworkDirection
type SourceFilter = "all" | DevtoolsNetworkSource
type DetailSectionId = "arguments" | "error" | "general" | "metadata" | "payload" | "result"

interface SelectedEntryState {
  entrySnapshot: DevtoolsNetworkEntry
  id: string
}

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Success", value: "success" },
  { label: "Sent", value: "sent" },
  { label: "Error", value: "error" }
]

const DIRECTION_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: DirectionFilter }> = [
  { label: "All", value: "all" },
  { label: "R -> M", value: "renderer-to-main" },
  { label: "M -> R", value: "main-to-renderer" },
  { label: "Internal", value: "internal" }
]

const SOURCE_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: SourceFilter }> = [
  { label: "All", value: "all" },
  { label: "IPC", value: "ipc" },
  { label: "Stream", value: "agent-stream" },
  { label: "Trace", value: "agent-trace" }
]

function formatTime(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
}

function formatDuration(entry: DevtoolsNetworkEntry): string {
  if (entry.durationMs === undefined) {
    return entry.status === "pending" ? "..." : "-"
  }

  return `${entry.durationMs.toFixed(entry.durationMs < 10 ? 2 : 1)} ms`
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function formatSummary(summary?: DevtoolsNetworkValueSummary): string {
  if (!summary) {
    return "-"
  }

  return formatJson(summary.preview)
}

function directionLabel(direction: DevtoolsNetworkDirection): string {
  if (direction === "renderer-to-main") {
    return "Renderer -> Main"
  }
  if (direction === "main-to-renderer") {
    return "Main -> Renderer"
  }
  return "Internal"
}

function directionIcon(direction: DevtoolsNetworkDirection): React.JSX.Element {
  if (direction === "renderer-to-main") {
    return <ArrowUpRight aria-hidden="true" size={14} />
  }
  if (direction === "main-to-renderer") {
    return <ArrowDownLeft aria-hidden="true" size={14} />
  }
  return <ArrowRightLeft aria-hidden="true" size={14} />
}

function statusLabel(status: DevtoolsNetworkStatus): string {
  if (status === "success") {
    return "Success"
  }
  if (status === "error") {
    return "Error"
  }
  if (status === "pending") {
    return "Pending"
  }
  return "Sent"
}

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " "
}

function hasSummary(summary?: DevtoolsNetworkValueSummary): boolean {
  return summary !== undefined
}

function summarySearchText(summary?: DevtoolsNetworkValueSummary): string {
  return summary ? formatSummary(summary) : ""
}

function entrySearchText(entry: DevtoolsNetworkEntry): string {
  return [
    entry.channel,
    entry.pattern,
    entry.source,
    entry.status,
    statusLabel(entry.status),
    directionLabel(entry.direction),
    entry.webContentsId?.toString() ?? "",
    summarySearchText(entry.metadata),
    summarySearchText(entry.payload),
    summarySearchText(entry.result),
    ...(entry.args ?? []).map((summary) => formatJson(summary.preview)),
    entry.error ? `${entry.error.name} ${entry.error.message}` : ""
  ]
    .join("\n")
    .toLowerCase()
}

function createGeneralDetails(
  entry: DevtoolsNetworkEntry
): Array<{ label: string; value: string }> {
  return [
    { label: "Channel", value: entry.channel },
    { label: "Direction", value: directionLabel(entry.direction) },
    { label: "Type", value: entry.pattern },
    { label: "Source", value: entry.source },
    { label: "Status", value: statusLabel(entry.status) },
    { label: "Started", value: formatTime(entry.startedAt) },
    { label: "Completed", value: entry.completedAt ? formatTime(entry.completedAt) : "-" },
    { label: "Duration", value: formatDuration(entry) },
    { label: "WebContents", value: entry.webContentsId?.toString() ?? "-" }
  ]
}

function createGeneralDetailText(entry: DevtoolsNetworkEntry): string {
  return createGeneralDetails(entry)
    .map((detail) => `${detail.label}: ${detail.value}`)
    .join("\n")
}

function createDefaultExpandedSections(
  entry: DevtoolsNetworkEntry
): Record<DetailSectionId, boolean> {
  return {
    arguments: (entry.args?.length ?? 0) > 0,
    error: entry.error !== undefined,
    general: true,
    metadata: hasSummary(entry.metadata),
    payload: hasSummary(entry.payload),
    result: hasSummary(entry.result)
  }
}

function createEntryDetailText(entry: DevtoolsNetworkEntry): Record<DetailSectionId, string> {
  return {
    arguments: formatJson((entry.args ?? []).map((summary) => summary.preview)),
    error: entry.error ? formatJson(entry.error) : "-",
    general: createGeneralDetailText(entry),
    metadata: formatSummary(entry.metadata),
    payload: formatSummary(entry.payload),
    result: formatSummary(entry.result)
  }
}

function buildAgentAnalysisText(entry: DevtoolsNetworkEntry): string {
  const detailText = createEntryDetailText(entry)
  const sections: Array<{ content: string; language: "json" | "text"; title: string }> = [
    { content: detailText.general, language: "text", title: "General" },
    { content: detailText.metadata, language: "json", title: "Event Metadata" },
    { content: detailText.arguments, language: "json", title: "IPC Arguments" },
    { content: detailText.payload, language: "json", title: "Event Payload" },
    { content: detailText.result, language: "json", title: "Response Result" },
    { content: detailText.error, language: "json", title: "Error" }
  ]

  return [
    "Please analyze this Jingle IPC Network event.",
    "",
    "## Event",
    `- Channel: ${entry.channel}`,
    `- Direction: ${directionLabel(entry.direction)}`,
    `- Type: ${entry.pattern}`,
    `- Source: ${entry.source}`,
    `- Status: ${statusLabel(entry.status)}`,
    `- Started: ${entry.startedAt}`,
    `- Duration: ${formatDuration(entry)}`,
    `- WebContents: ${entry.webContentsId ?? "-"}`,
    "- IPC Arguments: the original argument array passed after the IPC channel.",
    '- Event Payload: the structured body for recorder-appended stream, trace, or custom events; "-" is normal for plain IPC.',
    "",
    ...sections.flatMap(({ content, language, title }) => [
      `## ${title}`,
      `\`\`\`${language}`,
      content,
      "```",
      ""
    ])
  ].join("\n")
}

function FilterPill<T extends string>(props: {
  activeValue: T
  label: string
  onSelect: (value: T) => void
  value: T
}): React.JSX.Element {
  const { activeValue, label, onSelect, value } = props
  const isActive = activeValue === value

  return (
    <Button
      aria-pressed={isActive}
      className={`ipc-network-filter-pill ${isActive ? "is-active" : ""}`}
      onClick={() => onSelect(value)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {label}
    </Button>
  )
}

function NetworkDetailSection(props: {
  children: React.ReactNode
  copied: boolean
  expanded: boolean
  onCopy: () => void
  onToggle: () => void
  title: string
}): React.JSX.Element {
  const { children, copied, expanded, onCopy, onToggle, title } = props
  const copyLabel = copied ? `Copied ${title}` : `Copy ${title}`

  return (
    <section className={`ipc-network-json-section ${expanded ? "is-expanded" : ""}`}>
      <div className="ipc-network-json-section-header">
        <Button
          aria-expanded={expanded}
          className="ipc-network-json-section-toggle"
          onClick={onToggle}
          size="sm"
          type="button"
          variant="ghost"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={13} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} />
          )}
          <span>{title}</span>
        </Button>
        <IconButton
          className="ipc-network-section-copy-button"
          label={copyLabel}
          onClick={onCopy}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-[13px]" />
          ) : (
            <Copy aria-hidden="true" className="size-[13px]" />
          )}
        </IconButton>
      </div>
      {expanded ? <div className="ipc-network-section-body">{children}</div> : null}
    </section>
  )
}

function DetailPropertyList(props: {
  rows: Array<{ label: string; value: string }>
}): React.JSX.Element {
  return (
    <dl className="ipc-network-property-list">
      {props.rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd title={row.value}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function IpcNetworkApp(): React.JSX.Element {
  return (
    <TooltipProvider>
      <IpcNetworkContent />
    </TooltipProvider>
  )
}

function IpcNetworkContent(): React.JSX.Element {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all")
  const [expandedSectionsByEntryId, setExpandedSectionsByEntryId] = useState<
    Record<string, Record<DetailSectionId, boolean>>
  >({})
  const [entries, setEntries] = useState<DevtoolsNetworkEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntryState | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const copyResetTimerRef = useRef<number | null>(null)

  const selectEntry = useCallback((entry: DevtoolsNetworkEntry): void => {
    setSelectedEntry({
      entrySnapshot: entry,
      id: entry.id
    })
  }, [])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const nextEntries = await window.api.devtools.ipcNetwork.list()
      setEntries(nextEntries)
      setLoadError(null)
      setSelectedEntry((currentSelection) => {
        if (currentSelection) {
          return currentSelection
        }

        const latestEntry = nextEntries.at(-1)
        return latestEntry ? { entrySnapshot: latestEntry, id: latestEntry.id } : null
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const clearEntries = useCallback(async () => {
    await window.api.devtools.ipcNetwork.clear()
    setEntries([])
    setSelectedEntry(null)
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!autoRefresh) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadEntries()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoRefresh, loadEntries])

  const orderedEntries = useMemo(
    () => [...entries].sort((left, right) => right.sequence - left.sequence),
    [entries]
  )
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return orderedEntries.filter((entry) => {
      const matchesQuery =
        normalizedQuery.length === 0 || entrySearchText(entry).includes(normalizedQuery)
      const matchesDirection = directionFilter === "all" || entry.direction === directionFilter
      const matchesSource = sourceFilter === "all" || entry.source === sourceFilter
      const matchesStatus = statusFilter === "all" || entry.status === statusFilter
      return matchesQuery && matchesDirection && matchesSource && matchesStatus
    })
  }, [directionFilter, orderedEntries, query, sourceFilter, statusFilter])
  const selectedEntryFromAllEntries = selectedEntry
    ? (orderedEntries.find((entry) => entry.id === selectedEntry.id) ?? null)
    : null
  const selectedEntryDetailEntry =
    selectedEntryFromAllEntries ?? selectedEntry?.entrySnapshot ?? null
  const selectedEntryIsStale = selectedEntry !== null && !selectedEntryFromAllEntries
  const visibleEntries = useMemo(() => {
    if (!selectedEntryFromAllEntries) {
      return filteredEntries
    }

    if (filteredEntries.some((entry) => entry.id === selectedEntryFromAllEntries.id)) {
      return filteredEntries
    }

    return [selectedEntryFromAllEntries, ...filteredEntries]
  }, [filteredEntries, selectedEntryFromAllEntries])
  const selectedEntryMatchesFilter =
    selectedEntryIsStale ||
    !selectedEntryFromAllEntries ||
    filteredEntries.some((entry) => entry.id === selectedEntryFromAllEntries.id)
  const selectedEntryExpandedSections = selectedEntryDetailEntry
    ? (expandedSectionsByEntryId[selectedEntryDetailEntry.id] ??
      createDefaultExpandedSections(selectedEntryDetailEntry))
    : null
  const selectedEntryDetailText = selectedEntryDetailEntry
    ? createEntryDetailText(selectedEntryDetailEntry)
    : null
  const errorCount = entries.filter((entry) => entry.status === "error").length
  const pendingCount = entries.filter((entry) => entry.status === "pending").length
  const selectedEntryGeneralDetails = selectedEntryDetailEntry
    ? createGeneralDetails(selectedEntryDetailEntry)
    : []

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedKey((currentKey) => (currentKey === key ? null : currentKey))
        copyResetTimerRef.current = null
      }, 1400)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const toggleDetailSection = useCallback(
    (sectionId: DetailSectionId) => {
      if (!selectedEntryDetailEntry) {
        return
      }

      setExpandedSectionsByEntryId((current) => {
        const currentSections =
          current[selectedEntryDetailEntry.id] ??
          createDefaultExpandedSections(selectedEntryDetailEntry)
        return {
          ...current,
          [selectedEntryDetailEntry.id]: {
            ...currentSections,
            [sectionId]: !currentSections[sectionId]
          }
        }
      })
    },
    [selectedEntryDetailEntry]
  )

  const selectAdjacentEntry = useCallback(
    (entry: DevtoolsNetworkEntry, direction: "next" | "previous") => {
      const currentIndex = visibleEntries.findIndex((visibleEntry) => visibleEntry.id === entry.id)
      if (currentIndex === -1) {
        return
      }

      const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1
      const nextEntry = visibleEntries[nextIndex]
      if (nextEntry) {
        selectEntry(nextEntry)
      }
    },
    [selectEntry, visibleEntries]
  )

  return (
    <div className="ipc-network-app">
      <header className="ipc-network-toolbar">
        <div className="ipc-network-title">
          <div className="ipc-network-title-mark" aria-hidden="true">
            <Network size={15} />
          </div>
          <div className="ipc-network-title-copy">
            <h1>IPC Network</h1>
            <span>{entries.length} events</span>
          </div>
        </div>

        <label className="ipc-network-search">
          <Search aria-hidden="true" size={15} />
          <Input
            aria-label="Filter IPC events"
            placeholder="Filter channel, payload, status..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("")
              }
            }}
          />
        </label>

        <div className="ipc-network-controls">
          <IconButton
            className="ipc-network-icon-button"
            label="Auto-refresh"
            onClick={() => setAutoRefresh((value) => !value)}
            pressed={autoRefresh}
            tooltip={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
            type="button"
            variant="ghost"
          >
            {autoRefresh ? (
              <Pause aria-hidden="true" className="size-[15px]" />
            ) : (
              <Play aria-hidden="true" className="size-[15px]" />
            )}
          </IconButton>
          <IconButton
            className="ipc-network-icon-button"
            label="Refresh"
            loading={loading}
            loadingLabel="Refreshing IPC events"
            onClick={() => void loadEntries()}
            type="button"
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" className="size-[15px]" />
          </IconButton>
          <IconButton
            className="ipc-network-icon-button ipc-network-icon-button--danger"
            label="Clear IPC events"
            onClick={() => void clearEntries()}
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-[15px]" />
          </IconButton>
        </div>
      </header>

      <div className="ipc-network-filter-bar" aria-label="IPC Network filters">
        <div className="ipc-network-filter-group" aria-label="Status">
          <span>Status</span>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <FilterPill
              key={option.value}
              activeValue={statusFilter}
              label={option.label}
              onSelect={setStatusFilter}
              value={option.value}
            />
          ))}
        </div>
        <div className="ipc-network-filter-group" aria-label="Direction">
          <span>Direction</span>
          {DIRECTION_FILTER_OPTIONS.map((option) => (
            <FilterPill
              key={option.value}
              activeValue={directionFilter}
              label={option.label}
              onSelect={setDirectionFilter}
              value={option.value}
            />
          ))}
        </div>
        <div className="ipc-network-filter-group" aria-label="Source">
          <span>Source</span>
          {SOURCE_FILTER_OPTIONS.map((option) => (
            <FilterPill
              key={option.value}
              activeValue={sourceFilter}
              label={option.label}
              onSelect={setSourceFilter}
              value={option.value}
            />
          ))}
        </div>
      </div>

      <div className="ipc-network-summary-strip">
        <span>
          {visibleEntries.length} / {entries.length} events
        </span>
        <span>{pendingCount} pending</span>
        <span>{errorCount} errors</span>
        {!selectedEntryMatchesFilter ? <span>selected pinned outside filter</span> : null}
        {selectedEntryIsStale ? <span>selected no longer in live buffer</span> : null}
        {loadError ? <strong>{loadError}</strong> : null}
      </div>

      <main className="ipc-network-layout">
        <section className="ipc-network-table-shell" aria-label="IPC events">
          <table className="ipc-network-table">
            <thead>
              <tr>
                <th className="ipc-network-col-seq">#</th>
                <th className="ipc-network-col-time">Time</th>
                <th className="ipc-network-col-direction">Direction</th>
                <th className="ipc-network-col-source">Source</th>
                <th className="ipc-network-col-pattern">Type</th>
                <th className="ipc-network-col-status">Status</th>
                <th>Channel</th>
                <th className="ipc-network-col-duration">Duration</th>
                <th className="ipc-network-col-wc">WC</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.length > 0 ? (
                visibleEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    aria-selected={entry.id === selectedEntryDetailEntry?.id}
                    className={[
                      entry.id === selectedEntryDetailEntry?.id ? "is-selected" : "",
                      !filteredEntries.some((filteredEntry) => filteredEntry.id === entry.id)
                        ? "is-filter-kept"
                        : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    tabIndex={0}
                    onClick={() => selectEntry(entry)}
                    onKeyDown={(event) => {
                      if (isActivationKey(event.key)) {
                        event.preventDefault()
                        selectEntry(entry)
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault()
                        selectAdjacentEntry(selectedEntryDetailEntry ?? entry, "next")
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault()
                        selectAdjacentEntry(selectedEntryDetailEntry ?? entry, "previous")
                      }
                    }}
                  >
                    <td className="ipc-network-muted">#{entry.sequence}</td>
                    <td>{formatTime(entry.startedAt)}</td>
                    <td>
                      <span className="ipc-network-direction">
                        {directionIcon(entry.direction)}
                        {directionLabel(entry.direction)}
                      </span>
                    </td>
                    <td>{entry.source}</td>
                    <td>{entry.pattern}</td>
                    <td>
                      <span className={`ipc-network-status ipc-network-status--${entry.status}`}>
                        {statusLabel(entry.status)}
                      </span>
                    </td>
                    <td className="ipc-network-channel" title={entry.channel}>
                      {entry.channel}
                    </td>
                    <td>{formatDuration(entry)}</td>
                    <td>{entry.webContentsId ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr className="ipc-network-empty-row">
                  <td colSpan={9}>No matching IPC events</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <aside className="ipc-network-detail" aria-label="IPC event detail">
          {selectedEntryDetailEntry ? (
            <>
              <header className="ipc-network-detail-header">
                <div>
                  <h2 title={selectedEntryDetailEntry.channel}>
                    {selectedEntryDetailEntry.channel}
                  </h2>
                  <span>{directionLabel(selectedEntryDetailEntry.direction)}</span>
                </div>
                <div className="ipc-network-detail-actions">
                  {selectedEntryIsStale ? (
                    <span className="ipc-network-stale-badge">Snapshot</span>
                  ) : null}
                  <Button
                    aria-label={
                      copiedKey === `${selectedEntryDetailEntry.id}:agent`
                        ? "Copied event summary for agent analysis"
                        : "Copy event summary for agent analysis"
                    }
                    className="ipc-network-copy-agent-button"
                    onClick={() =>
                      void copyText(
                        buildAgentAnalysisText(selectedEntryDetailEntry),
                        `${selectedEntryDetailEntry.id}:agent`
                      )
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {copiedKey === `${selectedEntryDetailEntry.id}:agent` ? (
                      <Check aria-hidden="true" className="size-[13px]" />
                    ) : (
                      <Copy aria-hidden="true" className="size-[13px]" />
                    )}
                    <span>
                      {copiedKey === `${selectedEntryDetailEntry.id}:agent`
                        ? "Copied"
                        : "Copy to Agent"}
                    </span>
                  </Button>
                  <span
                    className={`ipc-network-status ipc-network-status--${selectedEntryDetailEntry.status}`}
                  >
                    {statusLabel(selectedEntryDetailEntry.status)}
                  </span>
                </div>
              </header>

              {selectedEntryExpandedSections && selectedEntryDetailText ? (
                <div className="ipc-network-detail-sections">
                  <NetworkDetailSection
                    copied={copiedKey === `${selectedEntryDetailEntry.id}:general`}
                    expanded={selectedEntryExpandedSections.general}
                    onCopy={() =>
                      void copyText(
                        selectedEntryDetailText.general,
                        `${selectedEntryDetailEntry.id}:general`
                      )
                    }
                    onToggle={() => toggleDetailSection("general")}
                    title="General"
                  >
                    <DetailPropertyList rows={selectedEntryGeneralDetails} />
                  </NetworkDetailSection>

                  <NetworkDetailSection
                    copied={copiedKey === `${selectedEntryDetailEntry.id}:metadata`}
                    expanded={selectedEntryExpandedSections.metadata}
                    onCopy={() =>
                      void copyText(
                        selectedEntryDetailText.metadata,
                        `${selectedEntryDetailEntry.id}:metadata`
                      )
                    }
                    onToggle={() => toggleDetailSection("metadata")}
                    title="Event Metadata"
                  >
                    <pre>{selectedEntryDetailText.metadata}</pre>
                  </NetworkDetailSection>

                  <NetworkDetailSection
                    copied={copiedKey === `${selectedEntryDetailEntry.id}:arguments`}
                    expanded={selectedEntryExpandedSections.arguments}
                    onCopy={() =>
                      void copyText(
                        selectedEntryDetailText.arguments,
                        `${selectedEntryDetailEntry.id}:arguments`
                      )
                    }
                    onToggle={() => toggleDetailSection("arguments")}
                    title="IPC Arguments"
                  >
                    <pre>{selectedEntryDetailText.arguments}</pre>
                  </NetworkDetailSection>

                  <NetworkDetailSection
                    copied={copiedKey === `${selectedEntryDetailEntry.id}:payload`}
                    expanded={selectedEntryExpandedSections.payload}
                    onCopy={() =>
                      void copyText(
                        selectedEntryDetailText.payload,
                        `${selectedEntryDetailEntry.id}:payload`
                      )
                    }
                    onToggle={() => toggleDetailSection("payload")}
                    title="Event Payload"
                  >
                    <pre>{selectedEntryDetailText.payload}</pre>
                  </NetworkDetailSection>

                  <NetworkDetailSection
                    copied={copiedKey === `${selectedEntryDetailEntry.id}:result`}
                    expanded={selectedEntryExpandedSections.result}
                    onCopy={() =>
                      void copyText(
                        selectedEntryDetailText.result,
                        `${selectedEntryDetailEntry.id}:result`
                      )
                    }
                    onToggle={() => toggleDetailSection("result")}
                    title="Response Result"
                  >
                    <pre>{selectedEntryDetailText.result}</pre>
                  </NetworkDetailSection>

                  <NetworkDetailSection
                    copied={copiedKey === `${selectedEntryDetailEntry.id}:error`}
                    expanded={selectedEntryExpandedSections.error}
                    onCopy={() =>
                      void copyText(
                        selectedEntryDetailText.error,
                        `${selectedEntryDetailEntry.id}:error`
                      )
                    }
                    onToggle={() => toggleDetailSection("error")}
                    title="Error"
                  >
                    <pre>{selectedEntryDetailText.error}</pre>
                  </NetworkDetailSection>
                </div>
              ) : null}
            </>
          ) : (
            <div className="ipc-network-empty">No event selected</div>
          )}
        </aside>
      </main>
    </div>
  )
}
