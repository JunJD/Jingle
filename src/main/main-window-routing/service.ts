import type { MainWindowNavigationPayload } from "../../shared/main-window"

export interface MainWindowRoutingRuntime {
  acknowledgePendingNavigation: (payload: MainWindowNavigationPayload) => void
  getPendingNavigation: () => MainWindowNavigationPayload | null
  openMainWindow: (payload?: MainWindowNavigationPayload) => void
}

export class MainWindowRoutingService {
  constructor(private readonly runtime: MainWindowRoutingRuntime) {}

  openWindow(payload?: MainWindowNavigationPayload): void {
    this.runtime.openMainWindow(payload)
  }

  openThread(threadId: string): void {
    this.runtime.openMainWindow({ targetThreadId: threadId })
  }

  getPendingNavigation(): MainWindowNavigationPayload | null {
    return this.runtime.getPendingNavigation()
  }

  acknowledgeNavigation(payload: MainWindowNavigationPayload): void {
    this.runtime.acknowledgePendingNavigation(payload)
  }
}
