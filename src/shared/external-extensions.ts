export type ExternalExtensionCommandMode = "view" | "no-view" | "menu-bar"

export interface ExternalExtensionPreferenceSchema {
  scope: "extension" | "command"
  name: string
  title?: string
  label?: string
  description?: string
  placeholder?: string
  required?: boolean
  type?: string
  default?: unknown
  data?: Array<{ title?: string; value?: string }>
}

export interface ExternalExtensionCommandSettingsSchema {
  name: string
  title: string
  description: string
  mode: ExternalExtensionCommandMode
  interval?: string
  disabledByDefault?: boolean
  preferences: ExternalExtensionPreferenceSchema[]
}

export interface InstalledExternalExtensionSettingsSchema {
  commands: ExternalExtensionCommandSettingsSchema[]
  description: string
  extName: string
  extensionPath: string
  iconDataUrl?: string
  owner: string
  preferences: ExternalExtensionPreferenceSchema[]
  sourceRoot: string
  title: string
}

export interface ExternalExtensionCommandArgumentDefinition {
  data?: Array<{ title?: string; value?: string }>
  name: string
  placeholder?: string
  required?: boolean
  title?: string
  type?: string
}

export interface ExternalExtensionCommandInfo {
  commandArgumentDefinitions: ExternalExtensionCommandArgumentDefinition[]
  commandName: string
  description: string
  disabledByDefault?: boolean
  extensionName: string
  extensionTitle: string
  iconDataUrl?: string
  id: string
  interval?: string
  keywords: string[]
  mode: ExternalExtensionCommandMode
  title: string
}

export interface ExternalExtensionBundleResult {
  assetsPath: string
  code: string
  commandArgumentDefinitions: ExternalExtensionCommandArgumentDefinition[]
  commandName: string
  commandPreferences: Record<string, unknown>
  extensionDisplayName: string
  extensionIconDataUrl?: string
  extensionName: string
  extensionPath: string
  mode: ExternalExtensionCommandMode
  owner: string
  preferenceDefinitions: ExternalExtensionPreferenceSchema[]
  preferences: Record<string, unknown>
  supportPath: string
  title: string
}

export interface GetExternalExtensionBundleRequest {
  commandName: string
  extensionName: string
}

export interface ExternalExtensionSettingsState {
  customRoots: string[]
}
