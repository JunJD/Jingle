import { Menu, shell, type MenuItemConstructorOptions } from "electron"

interface InstallApplicationMenuParams {
  isDev: boolean
  launcherShortcutAccelerator: string | null
  showIpcNetwork?: () => void
  showSettings: () => void
  showLauncher: () => void
  showMainWindow: () => void
}

interface ApplicationMenuDependencies {
  openExternal: (url: string) => Promise<void>
  reportHelpLinkFailure: (error: unknown) => Promise<void> | void
}

const JINGLE_GITHUB_URL = "https://github.com/JunJD/Jingle"

async function reportHelpLinkFailure(error: unknown): Promise<void> {
  try {
    const { diagnosticsGraph } = await import("./diagnostics/instance")
    diagnosticsGraph.capture({
      component: "application-menu",
      eventCode: "application_menu.help_link_open_failed",
      evidence: [{ kind: "error", value: error }],
      fingerprint: "application_menu.help_link_open_failed",
      level: "warn",
      operation: "open-help-link",
      recoverable: true,
      stateImpact: "none",
      summary: "Jingle could not open the GitHub help link"
    })
  } catch {
    console.error("[ApplicationMenu] Failed to record the help link failure.")
  }
}

const defaultApplicationMenuDependencies: ApplicationMenuDependencies = {
  openExternal: (url) => shell.openExternal(url),
  reportHelpLinkFailure
}

async function openHelpLink(dependencies: ApplicationMenuDependencies): Promise<void> {
  try {
    await dependencies.openExternal(JINGLE_GITHUB_URL)
  } catch (error) {
    try {
      await dependencies.reportHelpLinkFailure(error)
    } catch {
      console.error("[ApplicationMenu] Failed to record the help link failure.")
    }
  }
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

function createHelpMenu(dependencies: ApplicationMenuDependencies): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [
      {
        label: "Jingle on GitHub",
        click: () => {
          void openHelpLink(dependencies)
        }
      }
    ]
  }
}

export function createApplicationMenuTemplate(
  params: InstallApplicationMenuParams,
  dependencies: ApplicationMenuDependencies = defaultApplicationMenuDependencies
): MenuItemConstructorOptions[] {
  const mainSubjectItem: MenuItemConstructorOptions = {
    label: "Open Main Window",
    accelerator: "CommandOrControl+Alt+M",
    click: () => {
      params.showMainWindow()
    }
  }

  const launcherItem: MenuItemConstructorOptions = {
    label: "Show Launcher",
    ...(params.launcherShortcutAccelerator
      ? { accelerator: params.launcherShortcutAccelerator }
      : {}),
    // The global shortcut service owns execution; the menu only displays the binding.
    registerAccelerator: false,
    click: () => {
      params.showLauncher()
    }
  }

  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings",
    accelerator: "CommandOrControl+,",
    click: () => {
      params.showSettings()
    }
  }

  return process.platform === "darwin"
    ? [
        {
          label: "Jingle",
          role: "appMenu",
          submenu: [
            { role: "about" },
            { type: "separator" },
            settingsItem,
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        },
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
            { type: "separator" },
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" }
          ]
        },
        createHelpMenu(dependencies)
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
        createHelpMenu(dependencies)
      ]
}

export function installApplicationMenu(params: InstallApplicationMenuParams): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(params)))
}
