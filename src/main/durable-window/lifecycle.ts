export class DurableWindowLifecycleService {
  private openWindowCount = 0

  windowOpened(): void {
    this.openWindowCount += 1
  }

  windowClosed(): void {
    this.openWindowCount = Math.max(0, this.openWindowCount - 1)
  }

  getOpenWindowCount(): number {
    return this.openWindowCount
  }
}
