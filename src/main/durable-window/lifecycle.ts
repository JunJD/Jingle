export class DurableWindowLifecycleService {
  private openWindowCount = 0

  constructor(
    private readonly quitApplication: () => void,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  windowOpened(): void {
    this.openWindowCount += 1
  }

  windowClosed(): void {
    this.openWindowCount = Math.max(0, this.openWindowCount - 1)
    if (this.openWindowCount === 0 && this.platform === "linux") {
      this.quitApplication()
    }
  }

  getOpenWindowCount(): number {
    return this.openWindowCount
  }
}
