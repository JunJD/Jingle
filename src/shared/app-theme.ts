export type AppThemeVariant = "dark" | "light"

export interface AppThemeFonts {
  code: string | null
  ui: string | null
}

export interface AppThemeSemanticColors {
  diffAdded: string
  diffRemoved: string
  skill: string
}

export interface AppThemeTokens {
  accent: string
  contrast: number
  fonts: AppThemeFonts
  ink: string
  opaqueWindows: boolean
  semanticColors: AppThemeSemanticColors
  surface: string
}

export interface JingleThemeV1 {
  codeThemeId: string
  theme: AppThemeTokens
  variant: AppThemeVariant
}

export interface AppThemeSettings {
  config: JingleThemeV1
  presetId: AppThemePresetId | "custom"
}

export interface AppThemePreset {
  config: JingleThemeV1
  id: string
  name: string
}

export const DEFAULT_UI_FONT_FAMILY =
  '"OW Sans CN", "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", sans-serif'

export const DEFAULT_CODE_FONT_FAMILY =
  '"JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace'

const PROOF_THEME: JingleThemeV1 = {
  codeThemeId: "proof",
  theme: {
    accent: "#3d755d",
    contrast: 40,
    fonts: {
      code: null,
      ui: null
    },
    ink: "#2f312d",
    opaqueWindows: false,
    semanticColors: {
      diffAdded: "#3d755d",
      diffRemoved: "#ba2623",
      skill: "#5f6ac2"
    },
    surface: "#f5f3ed"
  },
  variant: "light"
}

export const APP_THEME_PRESETS = [
  {
    config: PROOF_THEME,
    id: "proof",
    name: "Proof"
  },
  {
    config: {
      codeThemeId: "vercel",
      theme: {
        accent: "#006aff",
        contrast: 40,
        fonts: {
          code: '"Geist Mono", ui-monospace, "SFMono-Regular"',
          ui: "Geist, Inter"
        },
        ink: "#171717",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#28A948",
          diffRemoved: "#EB001D",
          skill: "#A100F8"
        },
        surface: "#ffffff"
      },
      variant: "light"
    },
    id: "vercel",
    name: "Vercel"
  },
  {
    config: {
      codeThemeId: "everforest",
      theme: {
        accent: "#8da101",
        contrast: 42,
        fonts: {
          code: null,
          ui: null
        },
        ink: "#4f5b58",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#8da101",
          diffRemoved: "#f85552",
          skill: "#df69ba"
        },
        surface: "#fdf6e3"
      },
      variant: "light"
    },
    id: "everforest",
    name: "Everforest"
  },
  {
    config: {
      codeThemeId: "github",
      theme: {
        accent: "#0969da",
        contrast: 44,
        fonts: {
          code: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        ink: "#24292f",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#1a7f37",
          diffRemoved: "#cf222e",
          skill: "#8250df"
        },
        surface: "#ffffff"
      },
      variant: "light"
    },
    id: "github",
    name: "GitHub"
  },
  {
    config: {
      codeThemeId: "gruvbox",
      theme: {
        accent: "#b57614",
        contrast: 46,
        fonts: {
          code: null,
          ui: null
        },
        ink: "#3c3836",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#79740e",
          diffRemoved: "#9d0006",
          skill: "#8f3f71"
        },
        surface: "#fbf1c7"
      },
      variant: "light"
    },
    id: "gruvbox",
    name: "Gruvbox"
  },
  {
    config: {
      codeThemeId: "linear",
      theme: {
        accent: "#5e6ad2",
        contrast: 40,
        fonts: {
          code: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          ui: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        },
        ink: "#1f2328",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#26a06b",
          diffRemoved: "#e5484d",
          skill: "#5e6ad2"
        },
        surface: "#f7f8fa"
      },
      variant: "light"
    },
    id: "linear",
    name: "Linear"
  },
  {
    config: {
      codeThemeId: "notion",
      theme: {
        accent: "#2f3437",
        contrast: 36,
        fonts: {
          code: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        ink: "#2f3437",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#448361",
          diffRemoved: "#d44c47",
          skill: "#8f6bbd"
        },
        surface: "#ffffff"
      },
      variant: "light"
    },
    id: "notion",
    name: "Notion"
  },
  {
    config: {
      codeThemeId: "one",
      theme: {
        accent: "#4078f2",
        contrast: 38,
        fonts: {
          code: null,
          ui: null
        },
        ink: "#2d3138",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#50a14f",
          diffRemoved: "#e45649",
          skill: "#a626a4"
        },
        surface: "#fafafa"
      },
      variant: "light"
    },
    id: "one",
    name: "One"
  },
  {
    config: {
      codeThemeId: "raycast",
      theme: {
        accent: "#ff6363",
        contrast: 46,
        fonts: {
          code: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        ink: "#1f1f21",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#2da44e",
          diffRemoved: "#f85149",
          skill: "#8b5cf6"
        },
        surface: "#fbfbfb"
      },
      variant: "light"
    },
    id: "raycast",
    name: "Raycast"
  },
  {
    config: {
      codeThemeId: "rose-pine",
      theme: {
        accent: "#907aa9",
        contrast: 38,
        fonts: {
          code: null,
          ui: null
        },
        ink: "#575279",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#56949f",
          diffRemoved: "#b4637a",
          skill: "#907aa9"
        },
        surface: "#faf4ed"
      },
      variant: "light"
    },
    id: "rose-pine",
    name: "Rose Pine"
  }
] as const satisfies readonly AppThemePreset[]

export type AppThemePresetId = (typeof APP_THEME_PRESETS)[number]["id"]

export const DEFAULT_APP_THEME_SETTINGS: AppThemeSettings = {
  config: PROOF_THEME,
  presetId: "proof"
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value : fallback
}

function normalizeContrast(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback
}

function normalizeFont(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeVariant(value: unknown, fallback: AppThemeVariant): AppThemeVariant {
  return value === "dark" ? "dark" : fallback
}

function normalizeCodeThemeId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

export function findAppThemePreset(id: string): AppThemePreset | undefined {
  return APP_THEME_PRESETS.find((preset) => preset.id === id)
}

export function createAppThemeSettingsFromPreset(id: string): AppThemeSettings {
  const preset = findAppThemePreset(id) ?? APP_THEME_PRESETS[0]
  return {
    config: preset.config,
    presetId: preset.id as AppThemePresetId
  }
}

export function normalizeJingleThemeV1(
  value: unknown,
  fallback: JingleThemeV1 = PROOF_THEME
): JingleThemeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback
  }

  const raw = value as Partial<JingleThemeV1>
  const rawTheme =
    raw.theme && typeof raw.theme === "object" && !Array.isArray(raw.theme)
      ? (raw.theme as Partial<AppThemeTokens>)
      : {}
  const rawFonts =
    rawTheme.fonts && typeof rawTheme.fonts === "object" && !Array.isArray(rawTheme.fonts)
      ? (rawTheme.fonts as Partial<AppThemeFonts>)
      : {}
  const rawSemanticColors =
    rawTheme.semanticColors &&
    typeof rawTheme.semanticColors === "object" &&
    !Array.isArray(rawTheme.semanticColors)
      ? (rawTheme.semanticColors as Partial<AppThemeSemanticColors>)
      : {}

  return {
    codeThemeId: normalizeCodeThemeId(raw.codeThemeId, fallback.codeThemeId),
    theme: {
      accent: normalizeHexColor(rawTheme.accent, fallback.theme.accent),
      contrast: normalizeContrast(rawTheme.contrast, fallback.theme.contrast),
      fonts: {
        code: normalizeFont(rawFonts.code, fallback.theme.fonts.code),
        ui: normalizeFont(rawFonts.ui, fallback.theme.fonts.ui)
      },
      ink: normalizeHexColor(rawTheme.ink, fallback.theme.ink),
      opaqueWindows:
        typeof rawTheme.opaqueWindows === "boolean"
          ? rawTheme.opaqueWindows
          : fallback.theme.opaqueWindows,
      semanticColors: {
        diffAdded: normalizeHexColor(
          rawSemanticColors.diffAdded,
          fallback.theme.semanticColors.diffAdded
        ),
        diffRemoved: normalizeHexColor(
          rawSemanticColors.diffRemoved,
          fallback.theme.semanticColors.diffRemoved
        ),
        skill: normalizeHexColor(rawSemanticColors.skill, fallback.theme.semanticColors.skill)
      },
      surface: normalizeHexColor(rawTheme.surface, fallback.theme.surface)
    },
    variant: normalizeVariant(raw.variant, fallback.variant)
  }
}

export function normalizeAppThemeSettings(value: unknown): AppThemeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_APP_THEME_SETTINGS
  }

  const raw = value as Partial<AppThemeSettings>
  const preset = typeof raw.presetId === "string" ? findAppThemePreset(raw.presetId) : undefined
  const fallbackConfig = preset?.config ?? DEFAULT_APP_THEME_SETTINGS.config

  return {
    config: normalizeJingleThemeV1(raw.config, fallbackConfig),
    presetId: preset ? (preset.id as AppThemePresetId) : "custom"
  }
}

export function serializeJingleThemeV1(config: JingleThemeV1): string {
  return `jingle-theme-v1:${JSON.stringify(config)}`
}

export function parseJingleThemeV1Token(value: string): JingleThemeV1 | null {
  const trimmed = value.trim()
  const prefix = "jingle-theme-v1:"

  if (!trimmed.startsWith(prefix)) {
    return null
  }

  try {
    return normalizeJingleThemeV1(JSON.parse(trimmed.slice(prefix.length)))
  } catch {
    return null
  }
}
