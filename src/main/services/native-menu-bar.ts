import { BrowserWindow, Menu, Tray, nativeImage } from "electron"
import type { NativeMenuBarActionEvent, NativeMenuBarState } from "../../shared/native-menu-bar"

const trayByCommandKey = new Map<string, Tray>()
let getLauncherWindow: () => BrowserWindow | null = () => null
let defaultMenuBarImage: Electron.NativeImage | null = null

function createDefaultMenuBarImage(): Electron.NativeImage {
  if (defaultMenuBarImage) {
    return defaultMenuBarImage
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="8" fill="white" opacity="0.95" />
      <path d="M5.5 9.2L7.8 11.5L12.5 6.8" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    </svg>
  `.trim()

  defaultMenuBarImage = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  )
  defaultMenuBarImage.setTemplateImage(true)
  return defaultMenuBarImage
}

function emitMenuBarAction(event: NativeMenuBarActionEvent): void {
  const launcherWindow = getLauncherWindow()
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    return
  }

  launcherWindow.webContents.send("nativeMenuBar:itemSelected", event)
}

function buildMenuTemplate(state: NativeMenuBarState): Electron.MenuItemConstructorOptions[] {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (state.isLoading) {
    template.push({
      enabled: false,
      label: "Loading…"
    })
  }

  for (const section of state.sections) {
    if (section.title) {
      template.push({
        enabled: false,
        label: section.title
      })
    }

    for (const item of section.items) {
      template.push({
        click: () => {
          emitMenuBarAction({
            commandKey: state.commandKey,
            itemId: item.id
          })
        },
        enabled: item.disabled !== true,
        label: item.title,
        sublabel: item.subtitle
      })
    }

    template.push({ type: "separator" })
  }

  if (template.length > 0 && template[template.length - 1]?.type === "separator") {
    template.pop()
  }

  if (template.length === 0) {
    template.push({
      enabled: false,
      label: "No items"
    })
  }

  return template
}

function getOrCreateTray(commandKey: string): Tray {
  const existingTray = trayByCommandKey.get(commandKey)
  if (existingTray) {
    return existingTray
  }

  const tray = new Tray(createDefaultMenuBarImage())
  tray.setIgnoreDoubleClickEvents(true)
  trayByCommandKey.set(commandKey, tray)
  return tray
}

export function initializeNativeMenuBar(params: {
  getLauncherWindow: () => BrowserWindow | null
}): void {
  getLauncherWindow = params.getLauncherWindow
}

export function setNativeMenuBarState(state: NativeMenuBarState): void {
  const tray = getOrCreateTray(state.commandKey)
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(state)))
  tray.setToolTip(state.tooltip ?? state.title ?? "Openwork")

  if (process.platform === "darwin") {
    tray.setTitle(state.title ?? "")
  }
}

export function clearNativeMenuBarState(commandKey: string): void {
  const tray = trayByCommandKey.get(commandKey)
  if (!tray) {
    return
  }

  tray.destroy()
  trayByCommandKey.delete(commandKey)
}
