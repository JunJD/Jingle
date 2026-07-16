import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron"
import { join } from "path"

export interface AppEntryHandlers {
  openIpcNetwork?: () => void
  openLauncher: () => void
  openMainWindow: () => void
  openSettings: () => void
  quit: () => void
}

let appEntryTray: Tray | null = null

function createAppIcon(): Electron.NativeImage {
  const iconPath = join(__dirname, "../../resources/icon.png")
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    throw new Error(`App entry icon is empty: ${iconPath}`)
  }

  return icon
}

export function createAppEntryMenu(handlers: AppEntryHandlers): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: "Open Main Window", click: handlers.openMainWindow },
    {
      label: "Open Launcher",
      click: handlers.openLauncher
    },
    {
      label: "Settings",
      click: handlers.openSettings
    }
  ]

  if (handlers.openIpcNetwork) {
    items.push(
      { type: "separator" },
      {
        label: "IPC Network",
        click: handlers.openIpcNetwork
      }
    )
  }

  items.push(
    { type: "separator" },
    {
      label: "Quit",
      click: handlers.quit
    }
  )

  return items
}

export function installAppEntry(handlers: AppEntryHandlers): void {
  const menu = Menu.buildFromTemplate(createAppEntryMenu(handlers))

  if (process.platform === "darwin") {
    if (!app.dock) {
      throw new Error("macOS dock API is unavailable while installing the app entry menu.")
    }

    app.dock.setMenu(menu)
    app.dock.show()
    return
  }

  if (!appEntryTray) {
    appEntryTray = new Tray(createAppIcon().resize({ height: 16, width: 16 }))
    appEntryTray.setToolTip("Jingle")
    appEntryTray.on("click", handlers.openMainWindow)
    appEntryTray.on("double-click", handlers.openMainWindow)
  }

  appEntryTray.setContextMenu(menu)
}

export function disposeAppEntry(): void {
  if (appEntryTray) {
    appEntryTray.destroy()
  }
  appEntryTray = null
}
