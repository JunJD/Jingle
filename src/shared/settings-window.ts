import type { ProviderId } from "./app-types"

export type SettingsWindowTab =
  | "archived"
  | "appearance"
  | "general"
  | "memory"
  | "provider"
  | "quicklinks"
  | "extensions"
  | "shortcuts"

export interface SettingsWindowTarget {
  commandName?: string
  extensionName?: string
  providerId?: ProviderId
}

export interface SettingsWindowNavigationPayload {
  tab: SettingsWindowTab
  target?: SettingsWindowTarget
}
