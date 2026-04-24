import { useEffect, useState, type ReactNode } from "react"
import { FolderOpen, Languages, Layers2, Rocket } from "lucide-react"
import type { AgentConfig } from "@shared/app-types"
import type { LauncherSettings, LauncherWindowMode } from "@shared/launcher-settings"
import { SUPPORTED_APP_LOCALES, type AppLocale } from "@shared/i18n"
import { useI18n } from "../lib/i18n"
import { getSettingsCopy } from "./copy"

function SettingsRow(props: {
  children: ReactNode
  description: string
  icon: ReactNode
  title: string
  withBorder?: boolean
}): React.JSX.Element {
  const { children, description, icon, title, withBorder = true } = props

  return (
    <div
      className={`grid gap-3 px-4 py-4 md:grid-cols-[240px_minmax(0,1fr)] ${
        withBorder ? "border-b border-border/70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div className="space-y-1">
          <div className="text-[13px] font-semibold text-foreground">{title}</div>
          <div className="text-[12px] leading-5 text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function parseLineList(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const inputClassName =
  "w-full rounded-md border border-border bg-background-elevated px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-[var(--ring)]"

const selectClassName = `${inputClassName} pr-8`

const secondaryButtonClassName =
  "inline-flex items-center gap-2 rounded-md border border-border bg-background-elevated px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-background-secondary"

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
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        {locale === "zh-CN" ? "正在加载设置..." : "Loading settings..."}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4">
      <div className="px-1">
        <div className="text-[18px] font-semibold text-foreground">{copy.general.title}</div>
        <div className="mt-1 text-[13px] text-muted-foreground">{copy.general.workspaceHint}</div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-background-secondary/55 shadow-[0_18px_44px_rgba(32,38,45,0.06)]">
        <SettingsRow
          icon={<FolderOpen className="h-4 w-4" />}
          title={copy.general.workspaceTitle}
          description={copy.general.workspaceDescription}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[280px] flex-1 rounded-md border border-border/70 bg-background-elevated px-3 py-2 text-[13px] text-foreground">
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
          icon={<Rocket className="h-4 w-4" />}
          title={copy.general.launcherModeTitle}
          description={copy.general.launcherModeDescription}
        >
          <div className="max-w-[220px]">
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
          icon={<Languages className="h-4 w-4" />}
          title={copy.general.localeTitle}
          description={copy.general.localeDescription}
        >
          <div className="max-w-[220px]">
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
          icon={<Layers2 className="h-4 w-4" />}
          title={copy.general.skillSourcesTitle}
          description={copy.general.skillSourcesDescription}
        >
          <textarea
            className={`${inputClassName} min-h-[112px] resize-y`}
            value={skillSourcesDraft}
            onChange={(event) => {
              setSkillSourcesDraft(event.target.value)
            }}
            spellCheck={false}
          />
        </SettingsRow>

        <SettingsRow
          icon={<Layers2 className="h-4 w-4" />}
          title={copy.general.memorySourcesTitle}
          description={copy.general.memorySourcesDescription}
        >
          <textarea
            className={`${inputClassName} min-h-[112px] resize-y`}
            value={memorySourcesDraft}
            onChange={(event) => {
              setMemorySourcesDraft(event.target.value)
            }}
            spellCheck={false}
          />
        </SettingsRow>

        <SettingsRow
          icon={<Layers2 className="h-4 w-4" />}
          title={copy.general.desktopAutomationAllowlistTitle}
          description={copy.general.desktopAutomationAllowlistDescription}
        >
          <div className="space-y-3">
            <textarea
              className={`${inputClassName} min-h-[112px] resize-y`}
              value={desktopAutomationAllowlistDraft}
              onChange={(event) => {
                setDesktopAutomationAllowlistDraft(event.target.value)
              }}
              spellCheck={false}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => void saveAgentConfig()}
              >
                {copy.common.save}
              </button>
              {status ? <span className="text-[12px] text-muted-foreground">{status}</span> : null}
            </div>
          </div>
        </SettingsRow>
      </div>
    </div>
  )
}
