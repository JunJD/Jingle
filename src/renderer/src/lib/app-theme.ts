import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  type AppThemeSettings,
  type JingleThemeV1
} from "@shared/app-theme"

function mix(color: string, amount: number, base: string): string {
  return `color-mix(in srgb, ${color} ${amount}%, ${base})`
}

function setThemeVariable(targets: Array<HTMLElement | null>, name: string, value: string): void {
  for (const target of targets) {
    target?.style.setProperty(name, value)
  }
}

export function applyJingleTheme(config: JingleThemeV1): void {
  const root = document.documentElement
  const body = document.body
  const { theme, variant } = config
  const contrast = theme.contrast
  const raisedMix = Math.round(2 + contrast * 0.08)
  const secondaryMix = Math.round(4 + contrast * 0.18)
  const interactiveMix = Math.round(8 + contrast * 0.26)
  const borderMix = Math.round(6 + contrast * 0.12)
  const emphasisBorderMix = Math.round(12 + contrast * 0.16)
  const targets = [root, body]

  root.classList.toggle("dark", variant === "dark")
  body.classList.toggle("dark", variant === "dark")
  root.dataset.themeVariant = variant
  body.dataset.themeVariant = variant
  root.dataset.codeThemeId = config.codeThemeId
  body.dataset.codeThemeId = config.codeThemeId
  root.dataset.opaqueWindows = String(theme.opaqueWindows)
  body.dataset.opaqueWindows = String(theme.opaqueWindows)

  setThemeVariable(targets, "--background", theme.surface)
  setThemeVariable(targets, "--background-elevated", mix(theme.ink, raisedMix, theme.surface))
  setThemeVariable(targets, "--background-secondary", mix(theme.ink, secondaryMix, theme.surface))
  setThemeVariable(
    targets,
    "--background-interactive",
    mix(theme.ink, interactiveMix, theme.surface)
  )
  setThemeVariable(targets, "--foreground", theme.ink)
  setThemeVariable(targets, "--border", mix(theme.ink, borderMix, "transparent"))
  setThemeVariable(targets, "--border-emphasis", mix(theme.ink, emphasisBorderMix, "transparent"))
  setThemeVariable(targets, "--input", mix(theme.ink, emphasisBorderMix, "transparent"))
  setThemeVariable(targets, "--ring", theme.accent)
  setThemeVariable(targets, "--muted", mix(theme.ink, secondaryMix, theme.surface))
  setThemeVariable(targets, "--muted-foreground", mix(theme.ink, 64, theme.surface))
  setThemeVariable(targets, "--tertiary-foreground", mix(theme.ink, 48, theme.surface))
  setThemeVariable(targets, "--card", mix(theme.ink, raisedMix, theme.surface))
  setThemeVariable(targets, "--card-foreground", theme.ink)
  setThemeVariable(targets, "--popover", mix(theme.ink, raisedMix, theme.surface))
  setThemeVariable(targets, "--popover-foreground", theme.ink)
  setThemeVariable(targets, "--primary", theme.accent)
  setThemeVariable(targets, "--primary-foreground", theme.surface)
  setThemeVariable(targets, "--secondary", mix(theme.ink, secondaryMix, theme.surface))
  setThemeVariable(targets, "--secondary-foreground", theme.ink)
  setThemeVariable(targets, "--accent", theme.accent)
  setThemeVariable(targets, "--accent-foreground", theme.surface)
  setThemeVariable(targets, "--destructive", theme.semanticColors.diffRemoved)
  setThemeVariable(targets, "--status-critical", theme.semanticColors.diffRemoved)
  setThemeVariable(
    targets,
    "--status-warning",
    mix(theme.semanticColors.diffRemoved, 62, theme.accent)
  )
  setThemeVariable(targets, "--status-nominal", theme.semanticColors.diffAdded)
  setThemeVariable(targets, "--status-info", theme.accent)
  setThemeVariable(targets, "--jingle-semantic-skill", theme.semanticColors.skill)
  setThemeVariable(targets, "--sidebar", mix(theme.ink, raisedMix, theme.surface))
  setThemeVariable(targets, "--sidebar-foreground", theme.ink)
  setThemeVariable(targets, "--sidebar-primary", theme.accent)
  setThemeVariable(targets, "--sidebar-primary-foreground", theme.surface)
  setThemeVariable(targets, "--sidebar-accent", mix(theme.ink, secondaryMix, theme.surface))
  setThemeVariable(targets, "--sidebar-accent-foreground", theme.ink)
  setThemeVariable(targets, "--sidebar-border", mix(theme.ink, borderMix, "transparent"))
  setThemeVariable(targets, "--sidebar-ring", theme.accent)
  setThemeVariable(targets, "--window-chrome", mix(theme.ink, raisedMix, theme.surface))
  setThemeVariable(targets, "--window-divider", mix(theme.ink, borderMix, "transparent"))
  setThemeVariable(targets, "--window-chrome-foreground", theme.ink)
  setThemeVariable(targets, "--window-chrome-muted", mix(theme.ink, 52, theme.surface))
  setThemeVariable(targets, "--jingle-font-ui-family", theme.fonts.ui ?? DEFAULT_UI_FONT_FAMILY)
  setThemeVariable(targets, "--jingle-font-code-family", theme.fonts.code ?? DEFAULT_CODE_FONT_FAMILY)
}

export function applyAppThemeSettings(settings: AppThemeSettings): void {
  applyJingleTheme(settings.config)
}
