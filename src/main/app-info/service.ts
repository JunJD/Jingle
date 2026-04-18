import { app } from "electron"

export class AppInfoService {
  getVersion(): string {
    return app.getVersion()
  }
}
