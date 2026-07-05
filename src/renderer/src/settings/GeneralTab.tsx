import { useEffect, useReducer } from "react"
import { CornerDownRight, FolderOpen, Languages, Layers2, Rocket } from "lucide-react"
import type { AgentConfig } from "@shared/app-types"
import type { AgentFollowUpMode } from "@shared/agent-follow-up"
import type { LauncherSettings, LauncherWindowMode } from "@shared/launcher-settings"
import { SUPPORTED_APP_LOCALES, type AppLocale } from "@shared/i18n"
import { useI18n } from "@/lib/i18n"
import { getSettingsCopy } from "./copy"
import {
  inputClassName,
  secondaryButtonClassName,
  selectClassName,
  settingsCardClassName,
  settingsPageClassName,
  settingsPageDescriptionClassName,
  settingsPageHeaderClassName,
  settingsPageTitleClassName,
  SettingsRow
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

function getFollowUpModeLabel(
  mode: AgentFollowUpMode,
  copy: SettingsCopy
): string {
  if (mode === "queue") {
    return copy.general.followUpModeQueue
  }

  return copy.general.followUpModeSteer
}

interface GeneralTabState {
  agentConfig: AgentConfig | null
  desktopAutomationAllowlistDraft: string
  globalWorkspacePath: string | null
  launcherSettings: LauncherSettings | null
  skillSourcesDraft: string
  status: string
}

type GeneralTabAction =
  | {
      type: "loaded"
      agentConfig: AgentConfig
      globalWorkspacePath: string | null
      launcherSettings: LauncherSettings
    }
  | { type: "agent-config-saved"; agentConfig: AgentConfig; status: string }
  | { type: "desktop-automation-allowlist-changed"; value: string }
  | { type: "launcher-settings-changed"; launcherSettings: LauncherSettings }
  | { type: "skill-sources-changed"; value: string }
  | { type: "status-cleared" }
  | { type: "workspace-path-changed"; globalWorkspacePath: string | null }

const initialGeneralTabState: GeneralTabState = {
  agentConfig: null,
  desktopAutomationAllowlistDraft: "",
  globalWorkspacePath: null,
  launcherSettings: null,
  skillSourcesDraft: "",
  status: ""
}

function generalTabReducer(state: GeneralTabState, action: GeneralTabAction): GeneralTabState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        agentConfig: action.agentConfig,
        desktopAutomationAllowlistDraft:
          action.agentConfig.desktopAutomationAllowlist.join("\n"),
        globalWorkspacePath: action.globalWorkspacePath,
        launcherSettings: action.launcherSettings,
        skillSourcesDraft: action.agentConfig.skillSources.join("\n")
      }
    case "agent-config-saved":
      return {
        ...state,
        agentConfig: action.agentConfig,
        status: action.status
      }
    case "desktop-automation-allowlist-changed":
      return { ...state, desktopAutomationAllowlistDraft: action.value }
    case "launcher-settings-changed":
      return { ...state, launcherSettings: action.launcherSettings }
    case "skill-sources-changed":
      return { ...state, skillSourcesDraft: action.value }
    case "status-cleared":
      if (!state.status) {
        return state
      }

      return { ...state, status: "" }
    case "workspace-path-changed":
      return { ...state, globalWorkspacePath: action.globalWorkspacePath }
  }
}

export function GeneralTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const { setLocale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [state, dispatch] = useReducer(generalTabReducer, initialGeneralTabState)
  const {
    agentConfig,
    desktopAutomationAllowlistDraft,
    globalWorkspacePath,
    launcherSettings,
    skillSourcesDraft,
    status
  } = state

  useEffect(() => {
    void Promise.all([
      window.api.settings.getAgentConfig(),
      window.api.workspace.get(),
      window.api.settings.getLauncherSettings()
    ]).then(([nextAgentConfig, nextGlobalWorkspacePath, nextLauncherSettings]) => {
      dispatch({
        type: "loaded",
        agentConfig: nextAgentConfig,
        globalWorkspacePath: nextGlobalWorkspacePath,
        launcherSettings: nextLauncherSettings
      })
    })
  }, [])

  const saveAgentConfig = async (): Promise<void> => {
    const nextConfig = await window.api.settings.setAgentConfig({
      desktopAutomationAllowlist: parseLineList(desktopAutomationAllowlistDraft),
      skillSources: parseLineList(skillSourcesDraft)
    })
    dispatch({ type: "agent-config-saved", agentConfig: nextConfig, status: copy.general.saved })
    window.setTimeout(() => dispatch({ type: "status-cleared" }), 1600)
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
    const nextConfig = await window.api.settings.getAgentConfig()
    dispatch({ type: "agent-config-saved", agentConfig: nextConfig, status: "" })
  }

  const handleLauncherModeChange = async (nextMode: LauncherWindowMode): Promise<void> => {
    const nextSettings = await window.api.settings.setLauncherSettings({ windowMode: nextMode })
    dispatch({ type: "launcher-settings-changed", launcherSettings: nextSettings })
  }

  const handleFollowUpModeChange = async (nextMode: AgentFollowUpMode): Promise<void> => {
    const nextConfig = await window.api.settings.setAgentConfig({ followUpMode: nextMode })
    dispatch({ type: "agent-config-saved", agentConfig: nextConfig, status: "" })
  }

  if (!agentConfig || !launcherSettings) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--ow-font-label)] text-muted-foreground">
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
          icon={<FolderOpen className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.workspaceTitle}
          description={copy.general.workspaceDescription}
        >
          <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
            <div className="flex min-h-[var(--ow-settings-control-h)] min-w-[var(--ow-settings-field-min-width)] flex-1 items-center rounded-[var(--ow-radius-md)] border border-border/70 bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-settings-control-font)] text-foreground">
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
          icon={<Rocket className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.launcherModeTitle}
          description={copy.general.launcherModeDescription}
        >
          <div className="max-w-[var(--ow-settings-select-w)]">
            <select
              className={selectClassName}
              value={launcherSettings.windowMode}
              onChange={(event) => {
                void handleLauncherModeChange(event.target.value as LauncherWindowMode)
              }}
            >
              <option value="default">{copy.general.launcherModeDefault}</option>
              <option value="compact">{copy.general.launcherModeCompact}</option>
            </select>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Languages className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.localeTitle}
          description={copy.general.localeDescription}
        >
          <div className="max-w-[var(--ow-settings-select-w)]">
            <select
              className={selectClassName}
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
            </select>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<CornerDownRight className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.followUpModeTitle}
          description={copy.general.followUpModeDescription}
        >
          <div className="inline-flex min-h-[var(--ow-settings-control-h)] overflow-hidden rounded-[var(--ow-radius-md)] border border-border bg-background-elevated p-[var(--ow-space-0-5)]">
            {(["queue", "steer"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={agentConfig.followUpMode === mode}
                className={`rounded-[var(--ow-radius-sm)] px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-settings-control-font)] font-medium transition ${
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
          icon={<Layers2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.skillSourcesTitle}
          description={copy.general.skillSourcesDescription}
        >
          <textarea
            aria-label={copy.general.skillSourcesTitle}
            className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] resize-y`}
            value={skillSourcesDraft}
            onChange={(event) => {
              dispatch({ type: "skill-sources-changed", value: event.target.value })
            }}
            spellCheck={false}
          />
        </SettingsRow>

        <SettingsRow
          icon={<Layers2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.desktopAutomationAllowlistTitle}
          description={copy.general.desktopAutomationAllowlistDescription}
        >
          <div className="space-y-[var(--ow-space-3)]">
            <textarea
              aria-label={copy.general.desktopAutomationAllowlistTitle}
              className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] resize-y`}
              value={desktopAutomationAllowlistDraft}
              onChange={(event) => {
                dispatch({
                  type: "desktop-automation-allowlist-changed",
                  value: event.target.value
                })
              }}
              spellCheck={false}
            />
            <div className="flex items-center gap-[var(--ow-gap-md)]">
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => void saveAgentConfig()}
              >
                {copy.common.save}
              </button>
              {status ? (
                <span className="[font-size:var(--ow-font-body)] text-muted-foreground">
                  {status}
                </span>
              ) : null}
            </div>
          </div>
        </SettingsRow>
      </div>
    </div>
  )
}
