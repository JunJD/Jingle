import type { JingleAPI } from "./api"
import type { JingleElectronAPI } from "./electron-api"

declare global {
  interface Window {
    electron: JingleElectronAPI
    api: JingleAPI
  }
}
