import { BrowserWindow, dialog, shell, type IpcMain } from "electron"
import type { GetExternalExtensionBundleRequest } from "../../shared/external-extensions"
import {
  getConfiguredExternalExtensionCustomRoots,
  getExternalExtensionBundle,
  listInstalledExternalExtensionSettingsSchemas,
  listConfiguredExtensionRoots,
  listExternalExtensionCommands,
  setConfiguredExternalExtensionCustomRoots
} from "../services/extensions"

function emitExternalExtensionsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("extensions:changed")
    }
  }
}

export function registerExternalExtensionHandlers(ipcMain: IpcMain): void {

  ipcMain.handle("extensions:listCommands", () => {
    return listExternalExtensionCommands()
  })

  ipcMain.handle(
    "extensions:getBundle",
    async (_event, request: GetExternalExtensionBundleRequest) => {
      return getExternalExtensionBundle(request.extensionName, request.commandName)
    }
  )

  ipcMain.handle("extensions:listRoots", () => {
    return listConfiguredExtensionRoots()
  })

  ipcMain.handle("extensions:listSettingsSchemas", () => {
    return listInstalledExternalExtensionSettingsSchemas()
  })

  ipcMain.handle("extensions:getCustomRoots", () => {
    return getConfiguredExternalExtensionCustomRoots()
  })

  ipcMain.handle("extensions:setCustomRoots", (_event, nextRoots: string[]) => {
    const updated = setConfiguredExternalExtensionCustomRoots(nextRoots)
    emitExternalExtensionsChanged()
    return updated
  })

  ipcMain.handle("extensions:pickRoot", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select Extension Folder",
      message: "Choose a folder that contains Raycast extensions"
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0] ?? null
  })

  ipcMain.handle("extensions:revealPath", async (_event, targetPath: string) => {
    if (!targetPath) {
      return false
    }

    shell.showItemInFolder(targetPath)
    return true
  })
}
