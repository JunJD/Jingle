import { useCallback, useEffect, useReducer, useRef } from "react"
import {
  CornerDownRight,
  Download,
  FileArchive,
  FolderOpen,
  Languages,
  Layers2,
  Rocket
} from "lucide-react"
import type { AgentConfig } from "@shared/app-types"
import type { AgentFollowUpMode } from "@shared/agent-follow-up"
import type { ComputerUseSettingsRuntimeStatus } from "@shared/computer-use-settings"
import type { DiagnosticSupportPacketExportResult } from "@shared/diagnostics"
import type { LauncherSettings, LauncherWindowMode } from "@shared/launcher-settings"
import { SUPPORTED_APP_LOCALES, type AppLocale } from "@shared/i18n"
import { useI18n } from "@/lib/i18n"
import { getSettingsCopy } from "./copy"
import {
  inputClassName,
  secondaryButtonClassName,
  settingsCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch
} from "./settings-ui"

function parseLineList(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

type SettingsCopy = ReturnType<typeof getSettingsCopy>

function getLoadingSettingsLabel(locale: AppLocale): string {
  if (locale === "zh-CN") {
    return "正在加载设置..."
  }

  return "Loading settings..."
}

function getWorkspacePathLabel(path: string | null, copy: SettingsCopy): string {
  if (path) {
    return path
  }

  return copy.common.none
}

function getWorkspaceSelectLabel(path: string | null, copy: SettingsCopy): string {
  if (path) {
    return copy.common.change
  }

  return copy.common.choose
}

function getFollowUpModeLabel(mode: AgentFollowUpMode, copy: SettingsCopy): string {
  if (mode === "queue") {
    return copy.general.followUpModeQueue
  }

  return copy.general.followUpModeSteer
}

function getSupportPacketExportStatus(
  result: DiagnosticSupportPacketExportResult,
  copy: SettingsCopy
): string {
  if (result.kind === "exported") return copy.general.supportPacketExported
  if (result.kind === "cancelled") return copy.general.supportPacketCancelled
  return result.code === "destination_incomplete"
    ? copy.general.supportPacketIncomplete
    : copy.general.supportPacketFailed
}

interface GeneralTabState {
  agentConfig: AgentConfig | null
  computerUseApplicationAllowlistDraft: string
  computerUseRuntimeStatus: ComputerUseSettingsRuntimeStatus | null
  computerUseSaving: boolean
  globalWorkspacePath: string | null
  launcherSettings: LauncherSettings | null
  skillSourcesDraft: string
  status: string
  supportPacketExporting: boolean
  supportPacketStatus: string
}

type GeneralTabAction =
  | {
      type: "loaded"
      agentConfig: AgentConfig
      computerUseRuntimeStatus?: ComputerUseSettingsRuntimeStatus
      globalWorkspacePath: string | null
      launcherSettings: LauncherSettings
    }
  | {
      type: "agent-config-saved"
      agentConfig: AgentConfig
      computerUseRuntimeStatus?: ComputerUseSettingsRuntimeStatus
      status: string
    }
  | { type: "computer-use-save-failed"; status: string }
  | { type: "computer-use-save-started" }
  | {
      type: "computer-use-runtime-status-changed"
      computerUseRuntimeStatus: ComputerUseSettingsRuntimeStatus
    }
  | { type: "computer-use-allowlist-changed"; value: string }
  | { type: "computer-use-enabled-changed"; value: boolean }
  | { type: "launcher-settings-changed"; launcherSettings: LauncherSettings }
  | { type: "skill-sources-changed"; value: string }
  | { type: "status-changed"; status: string }
  | { type: "status-cleared" }
  | { type: "support-packet-export-finished"; status: string }
  | { type: "support-packet-export-started" }
  | { type: "support-packet-status-cleared" }
  | { type: "workspace-path-changed"; globalWorkspacePath: string | null }

const initialGeneralTabState: GeneralTabState = {
  agentConfig: null,
  computerUseApplicationAllowlistDraft: "",
  computerUseRuntimeStatus: null,
  computerUseSaving: false,
  globalWorkspacePath: null,
  launcherSettings: null,
  skillSourcesDraft: "",
  status: "",
  supportPacketExporting: false,
  supportPacketStatus: ""
}

function generalTabReducer(state: GeneralTabState, action: GeneralTabAction): GeneralTabState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        agentConfig: action.agentConfig,
        computerUseApplicationAllowlistDraft:
          action.agentConfig.computerUseApplicationAllowlist.join("\n"),
        ...(action.computerUseRuntimeStatus
          ? { computerUseRuntimeStatus: action.computerUseRuntimeStatus }
          : {}),
        globalWorkspacePath: action.globalWorkspacePath,
        launcherSettings: action.launcherSettings,
        skillSourcesDraft: action.agentConfig.skillSources.join("\n")
      }
    case "agent-config-saved":
      return {
        ...state,
        agentConfig: action.agentConfig,
        computerUseApplicationAllowlistDraft:
          action.agentConfig.computerUseApplicationAllowlist.join("\n"),
        ...(action.computerUseRuntimeStatus
          ? { computerUseRuntimeStatus: action.computerUseRuntimeStatus }
          : {}),
        computerUseSaving: false,
        status: action.status
      }
    case "computer-use-save-failed":
      return { ...state, computerUseSaving: false, status: action.status }
    case "computer-use-save-started":
      return { ...state, computerUseSaving: true, status: "" }
    case "computer-use-runtime-status-changed":
      return { ...state, computerUseRuntimeStatus: action.computerUseRuntimeStatus }
    case "computer-use-allowlist-changed":
      return { ...state, computerUseApplicationAllowlistDraft: action.value }
    case "computer-use-enabled-changed":
      return state.agentConfig
        ? {
            ...state,
            agentConfig: { ...state.agentConfig, computerUseEnabled: action.value }
          }
        : state
    case "launcher-settings-changed":
      return { ...state, launcherSettings: action.launcherSettings }
    case "skill-sources-changed":
      return { ...state, skillSourcesDraft: action.value }
    case "status-changed":
      return { ...state, status: action.status }
    case "status-cleared":
      if (!state.status) {
        return state
      }

      return { ...state, status: "" }
    case "support-packet-export-finished":
      return { ...state, supportPacketExporting: false, supportPacketStatus: action.status }
    case "support-packet-export-started":
      return { ...state, supportPacketExporting: true, supportPacketStatus: "" }
    case "support-packet-status-cleared":
      return state.supportPacketStatus ? { ...state, supportPacketStatus: "" } : state
    case "workspace-path-changed":
      return { ...state, globalWorkspacePath: action.globalWorkspacePath }
  }
}

export function GeneralTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const { setLocale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [state, dispatch] = useReducer(generalTabReducer, initialGeneralTabState)
  const computerUseStatusRequestGeneration = useRef(0)
  const {
    agentConfig,
    computerUseApplicationAllowlistDraft,
    computerUseRuntimeStatus,
    computerUseSaving,
    globalWorkspacePath,
    launcherSettings,
    skillSourcesDraft,
    status,
    supportPacketExporting,
    supportPacketStatus
  } = state

  const readComputerUseRuntimeStatus = useCallback(async () => {
    const generation = ++computerUseStatusRequestGeneration.current
    try {
      return {
        generation,
        status: await window.api.settings.getComputerUseRuntimeStatus()
      }
    } catch {
      return { generation, status: null }
    }
  }, [])

  useEffect(() => {
    void Promise.all([
      window.api.settings.getAgentConfig(),
      readComputerUseRuntimeStatus(),
      window.api.workspace.get(),
      window.api.settings.getLauncherSettings()
    ]).then(
      ([
        nextAgentConfig,
        computerUseRuntimeStatusRead,
        nextGlobalWorkspacePath,
        nextLauncherSettings
      ]) => {
        dispatch({
          type: "loaded",
          agentConfig: nextAgentConfig,
          ...(computerUseStatusRequestGeneration.current ===
            computerUseRuntimeStatusRead.generation && computerUseRuntimeStatusRead.status
            ? { computerUseRuntimeStatus: computerUseRuntimeStatusRead.status }
            : {}),
          globalWorkspacePath: nextGlobalWorkspacePath,
          launcherSettings: nextLauncherSettings
        })
      }
    )
  }, [readComputerUseRuntimeStatus])

  useEffect(() => {
    return window.api.settings.onAgentConfigChanged(() => {
      void readComputerUseRuntimeStatus().then((runtimeStatusRead) => {
        if (computerUseStatusRequestGeneration.current !== runtimeStatusRead.generation) return
        if (runtimeStatusRead.status) {
          dispatch({
            type: "computer-use-runtime-status-changed",
            computerUseRuntimeStatus: runtimeStatusRead.status
          })
        } else {
          dispatch({
            type: "status-changed",
            status: copy.general.computerUseStatusUnavailable
          })
        }
      })
    })
  }, [copy.general.computerUseStatusUnavailable, readComputerUseRuntimeStatus])

  useEffect(() => {
    if (!status) {
      return
    }

    const timeoutId = window.setTimeout(() => dispatch({ type: "status-cleared" }), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [status])

  useEffect(() => {
    if (!supportPacketStatus) return
    const timeoutId = window.setTimeout(
      () => dispatch({ type: "support-packet-status-cleared" }),
      2400
    )
    return () => window.clearTimeout(timeoutId)
  }, [supportPacketStatus])

  const saveAgentConfig = async (): Promise<void> => {
    dispatch({ type: "computer-use-save-started" })
    try {
      const result = await window.api.settings.setAgentConfig({
        computerUseApplicationAllowlist: parseLineList(computerUseApplicationAllowlistDraft),
        computerUseEnabled: agentConfig?.computerUseEnabled === true,
        skillSources: parseLineList(skillSourcesDraft)
      })
      computerUseStatusRequestGeneration.current += 1
      dispatch({
        type: "agent-config-saved",
        agentConfig: result.config,
        computerUseRuntimeStatus: result.computerUseRuntime,
        status: result.computerUseRuntime.state === "applied" ? copy.general.saved : ""
      })
    } catch {
      try {
        const [persistedConfig, runtimeStatusRead] = await Promise.all([
          window.api.settings.getAgentConfig(),
          readComputerUseRuntimeStatus()
        ])
        dispatch({
          type: "agent-config-saved",
          agentConfig: persistedConfig,
          ...(computerUseStatusRequestGeneration.current === runtimeStatusRead.generation &&
          runtimeStatusRead.status
            ? { computerUseRuntimeStatus: runtimeStatusRead.status }
            : {}),
          status: copy.general.saveUnavailable
        })
      } catch {
        dispatch({ type: "computer-use-save-failed", status: copy.general.saveUnavailable })
      }
    }
  }

  const handleWorkspaceSelect = async (): Promise<void> => {
    const nextPath = await window.api.workspace.select()
    if (nextPath !== null) {
      dispatch({ type: "workspace-path-changed", globalWorkspacePath: nextPath })
    }
  }

  const handleWorkspaceClear = async (): Promise<void> => {
    const nextPath = await window.api.workspace.set(undefined, null)
    dispatch({ type: "workspace-path-changed", globalWorkspacePath: nextPath })
  }

  const handleLocaleChange = async (nextLocale: AppLocale): Promise<void> => {
    await setLocale(nextLocale)
    const [nextConfig, runtimeStatusRead] = await Promise.all([
      window.api.settings.getAgentConfig(),
      readComputerUseRuntimeStatus()
    ])
    dispatch({
      type: "agent-config-saved",
      agentConfig: nextConfig,
      ...(computerUseStatusRequestGeneration.current === runtimeStatusRead.generation &&
      runtimeStatusRead.status
        ? { computerUseRuntimeStatus: runtimeStatusRead.status }
        : {}),
      status: ""
    })
  }

  const handleLauncherModeChange = async (nextMode: LauncherWindowMode): Promise<void> => {
    const nextSettings = await window.api.settings.setLauncherSettings({ windowMode: nextMode })
    dispatch({ type: "launcher-settings-changed", launcherSettings: nextSettings })
  }

  const handleFollowUpModeChange = async (nextMode: AgentFollowUpMode): Promise<void> => {
    const result = await window.api.settings.setAgentConfig({ followUpMode: nextMode })
    computerUseStatusRequestGeneration.current += 1
    dispatch({
      type: "agent-config-saved",
      agentConfig: result.config,
      computerUseRuntimeStatus: result.computerUseRuntime,
      status: ""
    })
  }

  const handleSupportPacketExport = async (): Promise<void> => {
    dispatch({ type: "support-packet-export-started" })
    try {
      const result = await window.api.diagnostics.exportSupportPacket()
      dispatch({
        type: "support-packet-export-finished",
        status: getSupportPacketExportStatus(result, copy)
      })
    } catch {
      dispatch({
        type: "support-packet-export-finished",
        status: copy.general.supportPacketFailed
      })
    }
  }

  if (!agentConfig || !launcherSettings) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--jingle-font-label)] text-muted-foreground">
        {getLoadingSettingsLabel(locale)}
      </div>
    )
  }

  return (
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <div className={settingsPageTitleClassName}>{copy.general.title}</div>
        <div className={settingsPageDescriptionClassName}>{copy.general.workspaceHint}</div>
      </div>

      <div className={settingsCardClassName}>
        <SettingsRow
          icon={
            <FolderOpen className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
          }
          title={copy.general.workspaceTitle}
          description={copy.general.workspaceDescription}
        >
          <div className="flex flex-wrap items-center gap-[var(--jingle-gap-md)]">
            <div className="flex min-h-[var(--jingle-settings-control-h)] min-w-[var(--jingle-settings-field-min-width)] flex-1 items-center rounded-[var(--jingle-radius-md)] border border-border/70 bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] [font-size:var(--jingle-settings-control-font)] text-foreground">
              {getWorkspacePathLabel(globalWorkspacePath, copy)}
            </div>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={handleWorkspaceSelect}
            >
              {getWorkspaceSelectLabel(globalWorkspacePath, copy)}
            </button>
            {globalWorkspacePath ? (
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={handleWorkspaceClear}
              >
                {copy.common.clear}
              </button>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Rocket className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />}
          title={copy.general.launcherModeTitle}
          description={copy.general.launcherModeDescription}
          titleId="settings-general-launcher-mode-title"
        >
          <div className="max-w-[var(--jingle-settings-select-w)]">
            <SettingsSelect
              aria-labelledby="settings-general-launcher-mode-title"
              value={launcherSettings.windowMode}
              onChange={(event) => {
                void handleLauncherModeChange(event.target.value as LauncherWindowMode)
              }}
            >
              <option value="default">{copy.general.launcherModeDefault}</option>
              <option value="compact">{copy.general.launcherModeCompact}</option>
            </SettingsSelect>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={
            <Languages className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
          }
          title={copy.general.localeTitle}
          description={copy.general.localeDescription}
          titleId="settings-general-locale-title"
        >
          <div className="max-w-[var(--jingle-settings-select-w)]">
            <SettingsSelect
              aria-labelledby="settings-general-locale-title"
              value={agentConfig.locale}
              onChange={(event) => {
                void handleLocaleChange(event.target.value as AppLocale)
              }}
            >
              {SUPPORTED_APP_LOCALES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </SettingsSelect>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={
            <CornerDownRight className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
          }
          title={copy.general.followUpModeTitle}
          description={copy.general.followUpModeDescription}
        >
          <div className="inline-flex min-h-[var(--jingle-settings-control-h)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated p-[var(--jingle-space-0-5)]">
            {(["queue", "steer"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={agentConfig.followUpMode === mode}
                className={`rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] [font-size:var(--jingle-settings-control-font)] font-medium transition ${
                  agentConfig.followUpMode === mode
                    ? "bg-background-secondary text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => void handleFollowUpModeChange(mode)}
              >
                {getFollowUpModeLabel(mode, copy)}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Layers2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />}
          title={copy.general.skillSourcesTitle}
          description={copy.general.skillSourcesDescription}
        >
          <textarea
            aria-label={copy.general.skillSourcesTitle}
            className={`${inputClassName} min-h-[var(--jingle-settings-textarea-min-h)] resize-y`}
            value={skillSourcesDraft}
            onChange={(event) => {
              dispatch({ type: "skill-sources-changed", value: event.target.value })
            }}
            spellCheck={false}
          />
        </SettingsRow>

        <SettingsRow
          icon={<Layers2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />}
          title={copy.general.computerUseTitle}
          description={copy.general.computerUseDescription}
        >
          <div className="space-y-[var(--jingle-space-3)]">
            <div className="flex items-center justify-between gap-[var(--jingle-gap-md)]">
              <span className="[font-size:var(--jingle-font-body)] text-foreground">
                {copy.general.computerUseEnabled}
              </span>
              <SettingsSwitch
                checked={agentConfig.computerUseEnabled}
                label={copy.general.computerUseEnabled}
                onCheckedChange={(value) => {
                  dispatch({ type: "computer-use-enabled-changed", value })
                }}
              />
            </div>
            <textarea
              aria-label={copy.general.computerUseAllowlist}
              className={`${inputClassName} min-h-[var(--jingle-settings-textarea-min-h)] resize-y`}
              value={computerUseApplicationAllowlistDraft}
              onChange={(event) => {
                dispatch({
                  type: "computer-use-allowlist-changed",
                  value: event.target.value
                })
              }}
              spellCheck={false}
            />
            <div className="flex items-center gap-[var(--jingle-gap-md)]">
              <button
                type="button"
                className={secondaryButtonClassName}
                disabled={computerUseSaving}
                onClick={() => void saveAgentConfig()}
              >
                {!computerUseSaving && computerUseRuntimeStatus?.state === "retry_required"
                  ? copy.general.computerUseRetry
                  : copy.common.save}
              </button>
              {status ? (
                <span className="[font-size:var(--jingle-font-body)] text-muted-foreground">
                  {status}
                </span>
              ) : null}
            </div>
            {computerUseRuntimeStatus ? (
              <div
                className="space-y-[var(--jingle-space-1)] [font-size:var(--jingle-font-body)] text-muted-foreground"
                role="status"
              >
                <p>
                  {computerUseSaving
                    ? copy.general.computerUseApplying
                    : computerUseRuntimeStatus.state === "applied"
                      ? copy.general.computerUseApplied
                      : computerUseRuntimeStatus.state === "applying"
                        ? copy.general.computerUseApplying
                        : copy.general.saveFailed}
                </p>
                {computerUseRuntimeStatus.state === "retry_required" ? (
                  <p>
                    {copy.general.computerUseDiagnostic}: {computerUseRuntimeStatus.diagnosticCode}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={
            <FileArchive className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
          }
          title={copy.general.supportPacketTitle}
          description={copy.general.supportPacketDescription}
          withBorder={false}
        >
          <div className="flex flex-wrap items-center gap-[var(--jingle-gap-md)]">
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={supportPacketExporting}
              onClick={() => void handleSupportPacketExport()}
            >
              <Download className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
              {supportPacketExporting
                ? copy.general.supportPacketExporting
                : copy.general.supportPacketExport}
            </button>
            {supportPacketStatus ? (
              <span className="[font-size:var(--jingle-font-body)] text-muted-foreground">
                {supportPacketStatus}
              </span>
            ) : null}
          </div>
        </SettingsRow>
      </div>
    </div>
  )
}
