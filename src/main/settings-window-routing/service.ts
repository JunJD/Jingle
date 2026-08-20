import type {
  SettingsWindowNavigationDelivery,
  SettingsWindowNavigationPayload
} from "@shared/settings-window"

export interface SettingsWindowRoutingRuntime {
  acknowledgeNavigation: (
    delivery: Pick<SettingsWindowNavigationDelivery, "rendererLoadEpoch" | "revision">
  ) => void
  claimPendingNavigation: () => SettingsWindowNavigationDelivery | null
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
}

export class SettingsWindowRoutingService {
  constructor(private readonly runtime: SettingsWindowRoutingRuntime) {}

  openWindow(payload?: SettingsWindowNavigationPayload): void {
    this.runtime.openSettingsWindow(payload)
  }

  acknowledgeNavigation(
    delivery: Pick<SettingsWindowNavigationDelivery, "rendererLoadEpoch" | "revision">
  ): void {
    this.runtime.acknowledgeNavigation(delivery)
  }

  getPendingNavigation(): SettingsWindowNavigationDelivery | null {
    return this.runtime.claimPendingNavigation()
  }
}
