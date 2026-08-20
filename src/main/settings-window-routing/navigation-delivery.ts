import type {
  SettingsWindowNavigationDelivery,
  SettingsWindowNavigationPayload
} from "@shared/settings-window"

export class SettingsWindowNavigationDeliveryOwner {
  private nextRevision = 1
  private pendingDelivery: SettingsWindowNavigationDelivery | null = null
  private rendererLoadEpoch = 0
  private rendererReady = false

  beginRendererLoad(): void {
    this.rendererLoadEpoch += 1
    this.rendererReady = false
    if (this.pendingDelivery) {
      this.pendingDelivery = {
        ...this.pendingDelivery,
        rendererLoadEpoch: this.rendererLoadEpoch
      }
    }
  }

  closeWindow(): void {
    this.pendingDelivery = null
    this.rendererReady = false
  }

  publish(payload: SettingsWindowNavigationPayload): SettingsWindowNavigationDelivery | undefined {
    const delivery = {
      revision: this.nextRevision++,
      rendererLoadEpoch: this.rendererLoadEpoch,
      payload
    }
    this.pendingDelivery = delivery
    return this.rendererReady ? delivery : undefined
  }

  claimPending(): SettingsWindowNavigationDelivery | null {
    this.rendererReady = true
    return this.pendingDelivery
  }

  acknowledge(
    input: Pick<SettingsWindowNavigationDelivery, "rendererLoadEpoch" | "revision">
  ): void {
    if (
      this.pendingDelivery?.revision === input.revision &&
      this.pendingDelivery.rendererLoadEpoch === input.rendererLoadEpoch
    ) {
      this.pendingDelivery = null
    }
  }
}
