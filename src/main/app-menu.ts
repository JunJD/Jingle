import { Menu, shell, type MenuItemConstructorOptions } from "electron"

interface InstallApplicationMenuParams {
  isDev: boolean
  launcherShortcutAccelerator: string | null
  showSettings: () => void
  showLauncher: () => void
}

function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" }
    ]
  }
}

function createViewMenu(isDev: boolean): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = []

  if (isDev) {
    submenu.push({ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" })
  }

  if (submenu.length > 0) {
    submenu.push({ type: "separator" })
  }

  submenu.push(
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" }
  )

  return {
    label: "View",
    submenu
  }
}

function createHelpMenu(): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [
      {
        label: "Openwork on GitHub",
        click: () => {
          void shell.openExternal("https://github.com/langchain-ai/openwork")
        }
      }
    ]
  }
}

export function installApplicationMenu(params: InstallApplicationMenuParams): void {
  const launcherItem: MenuItemConstructorOptions = {
    label: "Show Launcher",
    ...(params.launcherShortcutAccelerator
      ? { accelerator: params.launcherShortcutAccelerator }
      : {}),
    click: () => {
      params.showLauncher()
    }
  }

  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings",
    click: () => {
      params.showSettings()
    }
  }

  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          { role: "appMenu" },
          {
            label: "File",
            submenu: [{ role: "close" }]
          },
          createEditMenu(),
          createViewMenu(params.isDev),
          {
            label: "Window",
            submenu: [
              launcherItem,
              settingsItem,
              { type: "separator" },
              { role: "minimize" },
              { role: "zoom" },
              { type: "separator" },
              { role: "front" }
            ]
          },
          createHelpMenu()
        ]
      : [
          {
            label: "File",
            submenu: [launcherItem, settingsItem, { type: "separator" }, { role: "quit" }]
          },
          createEditMenu(),
          createViewMenu(params.isDev),
          {
            label: "Window",
            submenu: [{ role: "minimize" }, { role: "close" }]
          },
          createHelpMenu()
        ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
