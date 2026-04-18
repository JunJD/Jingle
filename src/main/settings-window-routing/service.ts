import type { SettingsWindowNavigationPayload } from "../../shared/settings-window"

export interface SettingsWindowRoutingRuntime {
  consumePendingNavigation: () => SettingsWindowNavigationPayload | null
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
}

export class SettingsWindowRoutingService {
  constructor(private readonly runtime: SettingsWindowRoutingRuntime) {}

  openWindow(payload?: SettingsWindowNavigationPayload): void {
    this.runtime.openSettingsWindow(payload)
  }

  getPendingNavigation(): SettingsWindowNavigationPayload | null {
    return this.runtime.consumePendingNavigation()
  }
}
