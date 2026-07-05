import { Menu, shell, type MenuItemConstructorOptions } from "electron"

interface InstallApplicationMenuParams {
  isDev: boolean
  launcherShortcutAccelerator: string | null
  showIpcNetwork?: () => void
  showSettings: () => void
  showLauncher: () => void
  showMainSubject: () => void
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

function createViewMenu(
  params: Pick<InstallApplicationMenuParams, "isDev" | "showIpcNetwork">
): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = []

  if (params.isDev) {
    submenu.push({ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" })
  }

  if (params.showIpcNetwork) {
    const showIpcNetwork = params.showIpcNetwork
    submenu.push(
      { type: "separator" },
      {
        label: "IPC Network",
        accelerator: "CommandOrControl+Alt+N",
        click: () => {
          showIpcNetwork()
        }
      }
    )
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
        label: "Jingle on GitHub",
        click: () => {
          void shell.openExternal("https://github.com/JunJD/Jingle")
        }
      }
    ]
  }
}

export function createApplicationMenuTemplate(
  params: InstallApplicationMenuParams
): MenuItemConstructorOptions[] {
  const mainSubjectItem: MenuItemConstructorOptions = {
    label: "Open Launcher",
    accelerator: "CommandOrControl+Alt+M",
    click: () => {
      params.showMainSubject()
    }
  }

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

  return process.platform === "darwin"
    ? [
        { label: "Jingle", role: "appMenu" },
        {
          label: "File",
          submenu: [{ role: "close" }]
        },
        createEditMenu(),
        createViewMenu(params),
        {
          label: "Window",
          submenu: [
            mainSubjectItem,
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
          submenu: [
            mainSubjectItem,
            launcherItem,
            settingsItem,
            { type: "separator" },
            { role: "quit" }
          ]
        },
        createEditMenu(),
        createViewMenu(params),
        {
          label: "Window",
          submenu: [{ role: "minimize" }, { role: "close" }]
        },
        createHelpMenu()
      ]
}

export function installApplicationMenu(params: InstallApplicationMenuParams): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(params)))
}
