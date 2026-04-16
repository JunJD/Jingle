import type { OpenworkAPI } from "./api"
import type { OpenworkElectronAPI } from "./electron-api"

declare global {
  interface Window {
    electron: OpenworkElectronAPI
    api: OpenworkAPI
  }
}
