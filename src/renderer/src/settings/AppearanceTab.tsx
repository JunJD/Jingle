import { useEffect, useMemo, useState } from "react"
import { Check, Code2, Copy, Eye, Paintbrush, Palette, SlidersHorizontal, Type } from "lucide-react"
import {
  APP_THEME_PRESETS,
  createAppThemeSettingsFromPreset,
  parseJingleThemeV1Token,
  serializeJingleThemeV1,
  type AppThemeSettings,
  type JingleThemeV1
} from "@shared/app-theme"
import type { AppLocale } from "@shared/i18n"
import { applyAppThemeSettings } from "../lib/app-theme"
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
  SettingsRow,
  SettingsSwitch
} from "./settings-ui"

const codeThemeOptions = [
  "proof",
  "vercel",
  "github",
  "notion",
  "raycast",
  "rose-pine",
  "everforest",
  "gruvbox",
  "linear",
  "one"
]

function getLoadingAppearanceLabel(locale: AppLocale): string {
  if (locale === "zh-CN") {
    return "正在加载外观设置..."
  }

  return "Loading appearance settings..."
}

function getPreviewFontFamily(theme: JingleThemeV1["theme"]): string {
  return theme.fonts.ui ?? "inherit"
}

function getFontInputValue(value: string | null | undefined): string {
  return value ?? ""
}

function normalizeFontInputValue(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return null
  }

  return trimmedValue
}

function ColorControl(props: {
  label: string
  onChange: (value: string) => void
  value: string
}): React.JSX.Element {
  const { label, onChange, value } = props

  return (
    <label className="grid gap-[var(--ow-space-1)]">
      <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-[var(--ow-gap-sm)]">
        <input
          aria-label={label}
          className="h-[var(--ow-settings-control-h)] w-[var(--ow-settings-control-h)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated p-[var(--ow-space-0-5)]"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className={`${inputClassName} max-w-[var(--ow-theme-color-input-w)] font-mono`}
          readOnly
          value={value}
          spellCheck={false}
        />
      </div>
    </label>
  )
}

function ThemePreview(props: { config: JingleThemeV1 }): React.JSX.Element {
  const { config } = props
  const { theme } = config
  const secondarySurface = `color-mix(in srgb, ${theme.ink} ${Math.round(
    4 + theme.contrast * 0.18
  )}%, ${theme.surface})`
  const interactiveSurface = `color-mix(in srgb, ${theme.ink} ${Math.round(
    8 + theme.contrast * 0.26
  )}%, ${theme.surface})`
  const border = `color-mix(in srgb, ${theme.ink} ${Math.round(
    6 + theme.contrast * 0.12
  )}%, transparent)`

  return (
    <div
      className="overflow-hidden rounded-[var(--ow-settings-card-radius)] border shadow-sm"
      style={{
        backgroundColor: theme.surface,
        borderColor: border,
        color: theme.ink,
        fontFamily: getPreviewFontFamily(theme)
      }}
    >
      <div
        className="grid border-b [font-size:var(--ow-font-meta)]"
        style={{
          backgroundColor: secondarySurface,
          borderColor: border,
          gridTemplateColumns: "var(--ow-theme-preview-line-column) minmax(0, 1fr)"
        }}
      >
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-right opacity-60">1</div>
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] font-mono">
          const themePreview = &#123;
        </div>
      </div>
      <div
        className="grid border-b [font-size:var(--ow-font-meta)]"
        style={{
          backgroundColor: `color-mix(in srgb, ${theme.semanticColors.diffRemoved} 14%, ${theme.surface})`,
          borderColor: border,
          gridTemplateColumns: "var(--ow-theme-preview-line-column) minmax(0, 1fr)"
        }}
      >
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-right opacity-60">2</div>
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] font-mono">
          - surface: &quot;sidebar&quot;,
        </div>
      </div>
      <div
        className="grid border-b [font-size:var(--ow-font-meta)]"
        style={{
          backgroundColor: `color-mix(in srgb, ${theme.semanticColors.diffAdded} 14%, ${theme.surface})`,
          borderColor: border,
          gridTemplateColumns: "var(--ow-theme-preview-line-column) minmax(0, 1fr)"
        }}
      >
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-right opacity-60">3</div>
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] font-mono">
          + accent: &quot;{theme.accent}&quot;,
        </div>
      </div>
      <div className="flex items-center justify-between gap-[var(--ow-gap-md)] px-[var(--ow-space-3)] py-[var(--ow-space-2)]">
        <div className="flex items-center gap-[var(--ow-gap-sm)]">
          <span
            className="h-[var(--ow-status-dot-size)] w-[var(--ow-status-dot-size)] rounded-full"
            style={{ backgroundColor: theme.semanticColors.skill }}
          />
          <span className="[font-size:var(--ow-font-body)]">skill</span>
        </div>
        <div
          className="rounded-full px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-font-caption)] font-semibold"
          style={{ backgroundColor: interactiveSurface, color: theme.accent }}
        >
          {config.codeThemeId}
        </div>
      </div>
    </div>
  )
}

type SettingsCopy = ReturnType<typeof getSettingsCopy>
type ThemeConfigUpdater = (updater: (config: JingleThemeV1) => JingleThemeV1) => void

function AppearanceThemeRow(props: {
  config: JingleThemeV1
  copy: SettingsCopy
  onCopyTheme: () => Promise<void>
  onPresetChange: (presetId: string) => void
  presetId: string
  status: string
}): React.JSX.Element {
  const { config, copy, onCopyTheme, onPresetChange, presetId, status } = props

  return (
    <SettingsRow
      icon={<Palette className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
      title={copy.appearance.themeTitle}
      description={copy.appearance.themeDescription}
    >
      <div className="grid gap-[var(--ow-gap-md)]">
        <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
          <select
            className={`${selectClassName} max-w-[var(--ow-settings-select-w)]`}
            value={presetId}
            onChange={(event) => onPresetChange(event.target.value)}
          >
            {APP_THEME_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
            <option value="custom">{copy.appearance.customTheme}</option>
          </select>
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={() => void onCopyTheme()}
          >
            <Copy className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.appearance.copyTheme}
          </button>
          {status ? (
            <span className="[font-size:var(--ow-font-body)] text-muted-foreground">
              {status}
            </span>
          ) : null}
        </div>
        <ThemePreview config={config} />
      </div>
    </SettingsRow>
  )
}

function AppearanceColorsRow(props: {
  copy: SettingsCopy
  theme: JingleThemeV1["theme"]
  updateConfig: ThemeConfigUpdater
}): React.JSX.Element {
  const { copy, theme, updateConfig } = props

  return (
    <SettingsRow
      icon={<Paintbrush className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
      title={copy.appearance.colorsTitle}
      description={copy.appearance.colorsDescription}
    >
      <div className="grid gap-[var(--ow-gap-md)] md:grid-cols-2">
        <ColorControl
          label={copy.appearance.accentColor}
          value={theme.accent}
          onChange={(accent) =>
            updateConfig((current) => ({
              ...current,
              theme: { ...current.theme, accent }
            }))
          }
        />
        <ColorControl
          label={copy.appearance.surfaceColor}
          value={theme.surface}
          onChange={(surface) =>
            updateConfig((current) => ({
              ...current,
              theme: { ...current.theme, surface }
            }))
          }
        />
        <ColorControl
          label={copy.appearance.inkColor}
          value={theme.ink}
          onChange={(ink) =>
            updateConfig((current) => ({
              ...current,
              theme: { ...current.theme, ink }
            }))
          }
        />
        <ColorControl
          label={copy.appearance.skillColor}
          value={theme.semanticColors.skill}
          onChange={(skill) =>
            updateConfig((current) => ({
              ...current,
              theme: {
                ...current.theme,
                semanticColors: { ...current.theme.semanticColors, skill }
              }
            }))
          }
        />
        <ColorControl
          label={copy.appearance.diffAddedColor}
          value={theme.semanticColors.diffAdded}
          onChange={(diffAdded) =>
            updateConfig((current) => ({
              ...current,
              theme: {
                ...current.theme,
                semanticColors: { ...current.theme.semanticColors, diffAdded }
              }
            }))
          }
        />
        <ColorControl
          label={copy.appearance.diffRemovedColor}
          value={theme.semanticColors.diffRemoved}
          onChange={(diffRemoved) =>
            updateConfig((current) => ({
              ...current,
              theme: {
                ...current.theme,
                semanticColors: { ...current.theme.semanticColors, diffRemoved }
              }
            }))
          }
        />
      </div>
    </SettingsRow>
  )
}

function AppearanceFontsRow(props: {
  copy: SettingsCopy
  theme: JingleThemeV1["theme"]
  updateConfig: ThemeConfigUpdater
}): React.JSX.Element {
  const { copy, theme, updateConfig } = props

  return (
    <SettingsRow
      icon={<Type className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
      title={copy.appearance.fontsTitle}
      description={copy.appearance.fontsDescription}
    >
      <div className="grid gap-[var(--ow-gap-md)]">
        <label className="grid gap-[var(--ow-space-1)]">
          <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
            {copy.appearance.uiFont}
          </span>
          <input
            className={inputClassName}
            value={getFontInputValue(theme.fonts.ui)}
            onChange={(event) => {
              const ui = normalizeFontInputValue(event.target.value)
              updateConfig((current) => ({
                ...current,
                theme: {
                  ...current.theme,
                  fonts: { ...current.theme.fonts, ui }
                }
              }))
            }}
            placeholder="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
            spellCheck={false}
          />
        </label>
        <label className="grid gap-[var(--ow-space-1)]">
          <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
            {copy.appearance.codeFont}
          </span>
          <input
            className={`${inputClassName} font-mono`}
            value={getFontInputValue(theme.fonts.code)}
            onChange={(event) => {
              const code = normalizeFontInputValue(event.target.value)
              updateConfig((current) => ({
                ...current,
                theme: {
                  ...current.theme,
                  fonts: { ...current.theme.fonts, code }
                }
              }))
            }}
            placeholder='ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'
            spellCheck={false}
          />
        </label>
      </div>
    </SettingsRow>
  )
}

function AppearanceBehaviorRow(props: {
  config: JingleThemeV1
  copy: SettingsCopy
  theme: JingleThemeV1["theme"]
  updateConfig: ThemeConfigUpdater
}): React.JSX.Element {
  const { config, copy, theme, updateConfig } = props

  return (
    <SettingsRow
      icon={<SlidersHorizontal className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
      title={copy.appearance.behaviorTitle}
      description={copy.appearance.behaviorDescription}
    >
      <div className="grid gap-[var(--ow-gap-md)]">
        <div className="grid gap-[var(--ow-space-1)]">
          <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
            {copy.appearance.variant}
          </span>
          <select
            className={`${selectClassName} max-w-[var(--ow-settings-select-w)]`}
            value={config.variant}
            onChange={(event) => {
              const variant = event.target.value === "dark" ? "dark" : "light"
              updateConfig((current) => ({ ...current, variant }))
            }}
          >
            <option value="light">{copy.appearance.lightVariant}</option>
            <option value="dark">{copy.appearance.darkVariant}</option>
          </select>
        </div>
        <div className="grid gap-[var(--ow-space-1)]">
          <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
            {copy.appearance.codeTheme}
          </span>
          <select
            className={`${selectClassName} max-w-[var(--ow-settings-select-w)]`}
            value={config.codeThemeId}
            onChange={(event) => {
              const codeThemeId = event.target.value
              updateConfig((current) => ({ ...current, codeThemeId }))
            }}
          >
            {codeThemeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-h-[var(--ow-settings-control-h)] items-center justify-between gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] border border-border bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)]">
          <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
            {copy.appearance.translucentWindows}
          </span>
          <SettingsSwitch
            checked={!theme.opaqueWindows}
            label={copy.appearance.translucentWindows}
            onCheckedChange={(checked) => {
              const opaqueWindows = !checked
              updateConfig((current) => ({
                ...current,
                theme: { ...current.theme, opaqueWindows }
              }))
            }}
          />
        </div>
        <label className="grid gap-[var(--ow-space-1)]">
          <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
            {copy.appearance.contrast}: {theme.contrast}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={theme.contrast}
            onChange={(event) => {
              const contrast = Number(event.target.value)
              updateConfig((current) => ({
                ...current,
                theme: { ...current.theme, contrast }
              }))
            }}
          />
        </label>
      </div>
    </SettingsRow>
  )
}

function AppearanceImportRow(props: {
  copy: SettingsCopy
  importDraft: string
  onImport: () => void
  onImportDraftChange: (draft: string) => void
  serializedTheme: string
}): React.JSX.Element {
  const { copy, importDraft, onImport, onImportDraftChange, serializedTheme } = props

  return (
    <SettingsRow
      icon={<Code2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
      title={copy.appearance.importTitle}
      description={copy.appearance.importDescription}
      withBorder={false}
    >
      <div className="grid gap-[var(--ow-gap-md)]">
        <textarea
          aria-label={copy.appearance.importTitle}
          className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] font-mono`}
          value={importDraft}
          onChange={(event) => onImportDraftChange(event.target.value)}
          placeholder={serializedTheme}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
          <button type="button" className={secondaryButtonClassName} onClick={onImport}>
            <Eye className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.appearance.importTheme}
          </button>
          <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-muted-foreground">
            <Check className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
            {copy.appearance.tokenFormat}
          </div>
        </div>
      </div>
    </SettingsRow>
  )
}

export function AppearanceTab(props: { locale: AppLocale }): React.JSX.Element {
  const { locale } = props
  const copy = getSettingsCopy(locale)
  const [themeSettings, setThemeSettings] = useState<AppThemeSettings | null>(null)
  const [importDraft, setImportDraft] = useState("")
  const [status, setStatus] = useState("")

  useEffect(() => {
    void window.api.settings.getAppThemeSettings().then((settings) => {
      setThemeSettings(settings)
      applyAppThemeSettings(settings)
    })

    return window.api.settings.onAppThemeSettingsChanged((settings) => {
      setThemeSettings(settings)
      applyAppThemeSettings(settings)
    })
  }, [])

  const serializedTheme = useMemo(() => {
    return themeSettings ? serializeJingleThemeV1(themeSettings.config) : ""
  }, [themeSettings])

  const commitThemeSettings = async (nextSettings: AppThemeSettings): Promise<void> => {
    setThemeSettings(nextSettings)
    applyAppThemeSettings(nextSettings)
    const saved = await window.api.settings.setAppThemeSettings(nextSettings)
    setThemeSettings(saved)
    applyAppThemeSettings(saved)
  }

  const updateConfig = (updater: (config: JingleThemeV1) => JingleThemeV1): void => {
    if (!themeSettings) {
      return
    }

    void commitThemeSettings({
      config: updater(themeSettings.config),
      presetId: "custom"
    })
  }

  const handlePresetChange = (presetId: string): void => {
    void commitThemeSettings(createAppThemeSettingsFromPreset(presetId))
  }

  const handleImport = (): void => {
    const parsed = parseJingleThemeV1Token(importDraft)
    if (!parsed) {
      setStatus(copy.appearance.importFailed)
      window.setTimeout(() => setStatus(""), 1600)
      return
    }

    void commitThemeSettings({
      config: parsed,
      presetId: "custom"
    }).then(() => {
      setStatus(copy.appearance.imported)
      window.setTimeout(() => setStatus(""), 1600)
    })
  }

  const handleCopyTheme = async (): Promise<void> => {
    await navigator.clipboard.writeText(serializedTheme)
    setStatus(copy.appearance.copied)
    window.setTimeout(() => setStatus(""), 1600)
  }

  if (!themeSettings) {
    return (
      <div className="flex h-full items-center justify-center [font-size:var(--ow-font-label)] text-muted-foreground">
        {getLoadingAppearanceLabel(locale)}
      </div>
    )
  }

  const config = themeSettings.config
  const theme = config.theme

  return (
    <div className={settingsPageClassName}>
      <div className={settingsPageHeaderClassName}>
        <div className={settingsPageTitleClassName}>{copy.appearance.title}</div>
        <div className={settingsPageDescriptionClassName}>{copy.appearance.description}</div>
      </div>

      <div className={settingsCardClassName}>
        <AppearanceThemeRow
          config={config}
          copy={copy}
          onCopyTheme={handleCopyTheme}
          onPresetChange={handlePresetChange}
          presetId={themeSettings.presetId}
          status={status}
        />
        <AppearanceColorsRow copy={copy} theme={theme} updateConfig={updateConfig} />
        <AppearanceFontsRow copy={copy} theme={theme} updateConfig={updateConfig} />
        <AppearanceBehaviorRow
          config={config}
          copy={copy}
          theme={theme}
          updateConfig={updateConfig}
        />
        <AppearanceImportRow
          copy={copy}
          importDraft={importDraft}
          onImport={handleImport}
          onImportDraftChange={setImportDraft}
          serializedTheme={serializedTheme}
        />
      </div>
    </div>
  )
}
