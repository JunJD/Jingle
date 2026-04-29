import { useEffect, useMemo, useState } from "react"
import { Check, Code2, Copy, Eye, Paintbrush, Palette, SlidersHorizontal, Type } from "lucide-react"
import {
  APP_THEME_PRESETS,
  createAppThemeSettingsFromPreset,
  parseCodexThemeV1Token,
  serializeCodexThemeV1,
  type AppThemeSettings,
  type CodexThemeV1
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
  SettingsRow
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

function ThemePreview(props: { config: CodexThemeV1 }): React.JSX.Element {
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
        fontFamily: theme.fonts.ui ?? "inherit"
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
    return themeSettings ? serializeCodexThemeV1(themeSettings.config) : ""
  }, [themeSettings])

  const commitThemeSettings = async (nextSettings: AppThemeSettings): Promise<void> => {
    setThemeSettings(nextSettings)
    applyAppThemeSettings(nextSettings)
    const saved = await window.api.settings.setAppThemeSettings(nextSettings)
    setThemeSettings(saved)
    applyAppThemeSettings(saved)
  }

  const updateConfig = (updater: (config: CodexThemeV1) => CodexThemeV1): void => {
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
    const parsed = parseCodexThemeV1Token(importDraft)
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
        {locale === "zh-CN" ? "正在加载外观设置..." : "Loading appearance settings..."}
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
        <SettingsRow
          icon={<Palette className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.appearance.themeTitle}
          description={copy.appearance.themeDescription}
        >
          <div className="grid gap-[var(--ow-gap-md)]">
            <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
              <select
                className={`${selectClassName} max-w-[var(--ow-settings-select-w)]`}
                value={themeSettings.presetId}
                onChange={(event) => handlePresetChange(event.target.value)}
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
                onClick={() => void handleCopyTheme()}
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
                value={theme.fonts.ui ?? ""}
                onChange={(event) => {
                  const ui = event.target.value.trim() || null
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
                value={theme.fonts.code ?? ""}
                onChange={(event) => {
                  const code = event.target.value.trim() || null
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

        <SettingsRow
          icon={
            <SlidersHorizontal className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />
          }
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
            <label className="flex items-center justify-between gap-[var(--ow-gap-md)]">
              <span className="[font-size:var(--ow-font-body)] font-medium text-muted-foreground">
                {copy.appearance.translucentWindows}
              </span>
              <input
                type="checkbox"
                checked={!theme.opaqueWindows}
                onChange={(event) => {
                  const opaqueWindows = !event.target.checked
                  updateConfig((current) => ({
                    ...current,
                    theme: { ...current.theme, opaqueWindows }
                  }))
                }}
              />
            </label>
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

        <SettingsRow
          icon={<Code2 className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)]" />}
          title={copy.appearance.importTitle}
          description={copy.appearance.importDescription}
          withBorder={false}
        >
          <div className="grid gap-[var(--ow-gap-md)]">
            <textarea
              className={`${inputClassName} min-h-[var(--ow-settings-textarea-min-h)] font-mono`}
              value={importDraft}
              onChange={(event) => setImportDraft(event.target.value)}
              placeholder={serializedTheme}
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center gap-[var(--ow-gap-md)]">
              <button type="button" className={secondaryButtonClassName} onClick={handleImport}>
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
      </div>
    </div>
  )
}
