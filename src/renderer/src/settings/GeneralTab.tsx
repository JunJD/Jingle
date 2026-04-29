import { useEffect, useState } from "react"
import { FolderOpen, Languages, Layers2, Rocket } from "lucide-react"
import type { AgentConfig } from "@shared/app-types"
import type { LauncherSettings, LauncherWindowMode } from "@shared/launcher-settings"
import { SUPPORTED_APP_LOCALES, type AppLocale } from "@shared/i18n"
import { useI18n } from "../lib/i18n"
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

export function GeneralTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const { setLocale } = useI18n()
  const copy = getSettingsCopy(locale)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [desktopAutomationAllowlistDraft, setDesktopAutomationAllowlistDraft] = useState("")
  const [globalWorkspacePath, setGlobalWorkspacePath] = useState<string | null>(null)
  const [launcherSettings, setLauncherSettings] = useState<LauncherSettings | null>(null)
  const [memorySourcesDraft, setMemorySourcesDraft] = useState("")
  const [skillSourcesDraft, setSkillSourcesDraft] = useState("")
  const [status, setStatus] = useState<string>("")

  useEffect(() => {
    void Promise.all([
      window.api.settings.getAgentConfig(),
      window.api.workspace.get(),
      window.api.settings.getLauncherSettings()
    ]).then(([nextAgentConfig, nextGlobalWorkspacePath, nextLauncherSettings]) => {
      setAgentConfig(nextAgentConfig)
      setGlobalWorkspacePath(nextGlobalWorkspacePath)
      setLauncherSettings(nextLauncherSettings)
      setDesktopAutomationAllowlistDraft(nextAgentConfig.desktopAutomationAllowlist.join("\n"))
      setSkillSourcesDraft(nextAgentConfig.skillSources.join("\n"))
      setMemorySourcesDraft(nextAgentConfig.memorySources.join("\n"))
    })
  }, [])

  const saveAgentConfig = async (): Promise<void> => {
    const nextConfig = await window.api.settings.setAgentConfig({
      desktopAutomationAllowlist: parseLineList(desktopAutomationAllowlistDraft),
      memorySources: parseLineList(memorySourcesDraft),
      skillSources: parseLineList(skillSourcesDraft)
    })
    setAgentConfig(nextConfig)
    setStatus(copy.general.saved)
    window.setTimeout(() => setStatus(""), 1600)
  }

  const handleWorkspaceSelect = async (): Promise<void> => {
    const nextPath = await window.api.workspace.select()
    if (nextPath !== null) {
      setGlobalWorkspacePath(nextPath)
    }
  }

  const handleWorkspaceClear = async (): Promise<void> => {
    const nextPath = await window.api.workspace.set(undefined, null)
    setGlobalWorkspacePath(nextPath)
  }

  const handleLocaleChange = async (nextLocale: AppLocale): Promise<void> => {
    await setLocale(nextLocale)
    const nextConfig = await window.api.settings.getAgentConfig()
    setAgentConfig(nextConfig)
  }

  const handleLauncherModeChange = async (nextMode: LauncherWindowMode): Promise<void> => {
    const nextSettings = await window.api.settings.setLauncherSettings({ windowMode: nextMode })
    setLauncherSettings(nextSettings)
  }

  if (!agentConfig || !launcherSettings) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--ow-font-label)] text-muted-foreground">
        {locale === "zh-CN" ? "正在加载设置..." : "Loading settings..."}
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
              {globalWorkspacePath || copy.common.none}
            </div>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={handleWorkspaceSelect}
            >
              {globalWorkspacePath ? copy.common.change : copy.common.choose}
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
          icon={<Layers2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.skillSourcesTitle}
          description={copy.general.skillSourcesDescription}
        >
          <textarea
            className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] resize-y`}
            value={skillSourcesDraft}
            onChange={(event) => {
              setSkillSourcesDraft(event.target.value)
            }}
            spellCheck={false}
          />
        </SettingsRow>

        <SettingsRow
          icon={<Layers2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.general.memorySourcesTitle}
          description={copy.general.memorySourcesDescription}
        >
          <textarea
            className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] resize-y`}
            value={memorySourcesDraft}
            onChange={(event) => {
              setMemorySourcesDraft(event.target.value)
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
              className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] resize-y`}
              value={desktopAutomationAllowlistDraft}
              onChange={(event) => {
                setDesktopAutomationAllowlistDraft(event.target.value)
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
