export class DurableWindowLifecycleService {
  private readonly openSupportingWindows = new Set<object>()
  private exitDeferredBySupportingWindow = false
  private exitRequested = false
  private openWindowCount = 0

  constructor(
    private readonly quitApplication: () => void,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  windowOpened(): void {
    this.openWindowCount += 1
    this.exitDeferredBySupportingWindow = false
  }

  windowClosed(): void {
    this.openWindowCount = Math.max(0, this.openWindowCount - 1)
    if (this.openWindowCount !== 0 || this.platform === "darwin") return

    if (this.openSupportingWindows.size > 0) {
      this.exitDeferredBySupportingWindow = true
      return
    }

    this.requestExit()
  }

  supportingWindowOpened(window: object): void {
    this.openSupportingWindows.add(window)
  }

  supportingWindowClosed(window: object): void {
    this.openSupportingWindows.delete(window)
    if (
      this.exitDeferredBySupportingWindow &&
      this.openWindowCount === 0 &&
      this.openSupportingWindows.size === 0
    ) {
      this.requestExit()
    }
  }

  getOpenWindowCount(): number {
    return this.openWindowCount
  }

  private requestExit(): void {
    if (this.exitRequested) return
    this.exitRequested = true
    this.quitApplication()
  }
}
