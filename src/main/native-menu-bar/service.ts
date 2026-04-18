import { BrowserWindow, Menu, Tray, nativeImage } from "electron"
import type { NativeMenuBarActionEvent, NativeMenuBarState } from "../../shared/native-menu-bar"

interface NativeMenuBarBddProbe {
  getStates: () => NativeMenuBarState[]
  selectItem: (event: NativeMenuBarActionEvent) => void
}

const BDD_NATIVE_MENU_BAR_PROBE_KEY = "__OPENWORK_BDD_NATIVE_MENU_BAR__"

export class NativeMenuBarService {
  private readonly stateByCommandKey = new Map<string, NativeMenuBarState>()
  private readonly trayByCommandKey = new Map<string, Tray>()
  private getLauncherWindow: () => BrowserWindow | null = () => null
  private defaultMenuBarImage: Electron.NativeImage | null = null

  initialize(params: { getLauncherWindow: () => BrowserWindow | null }): void {
    this.getLauncherWindow = params.getLauncherWindow

    if (process.env.OPENWORK_BDD === "1") {
      this.attachBddProbe()
    }
  }

  dispose(): void {
    for (const tray of this.trayByCommandKey.values()) {
      tray.destroy()
    }

    this.trayByCommandKey.clear()
    this.stateByCommandKey.clear()
    this.detachBddProbe()
  }

  setState(state: NativeMenuBarState): void {
    const tray = this.getOrCreateTray(state.commandKey)

    this.stateByCommandKey.set(state.commandKey, this.cloneState(state))
    tray.setContextMenu(Menu.buildFromTemplate(this.buildMenuTemplate(state)))
    tray.setToolTip(state.tooltip ?? state.title ?? "Openwork")

    if (process.platform === "darwin") {
      tray.setTitle(state.title ?? "")
    }
  }

  clearState(commandKey: string): void {
    const tray = this.trayByCommandKey.get(commandKey)
    if (tray) {
      tray.destroy()
      this.trayByCommandKey.delete(commandKey)
    }

    this.stateByCommandKey.delete(commandKey)
  }

  getStateSnapshot(): NativeMenuBarState[] {
    return Array.from(this.stateByCommandKey.values(), (state) => this.cloneState(state))
  }

  emitSelectionForTesting(event: NativeMenuBarActionEvent): void {
    if (!this.stateByCommandKey.has(event.commandKey)) {
      throw new Error(`Native menu bar command not found: ${event.commandKey}`)
    }

    this.emitMenuBarAction(event)
  }

  private attachBddProbe(): void {
    ;(
      globalThis as typeof globalThis & {
        [BDD_NATIVE_MENU_BAR_PROBE_KEY]?: NativeMenuBarBddProbe
      }
    )[BDD_NATIVE_MENU_BAR_PROBE_KEY] = {
      getStates: () => this.getStateSnapshot(),
      selectItem: (event) => this.emitSelectionForTesting(event)
    }
  }

  private detachBddProbe(): void {
    delete (
      globalThis as typeof globalThis & {
        [BDD_NATIVE_MENU_BAR_PROBE_KEY]?: NativeMenuBarBddProbe
      }
    )[BDD_NATIVE_MENU_BAR_PROBE_KEY]
  }

  private cloneState(state: NativeMenuBarState): NativeMenuBarState {
    return JSON.parse(JSON.stringify(state)) as NativeMenuBarState
  }

  private createDefaultMenuBarImage(): Electron.NativeImage {
    if (this.defaultMenuBarImage) {
      return this.defaultMenuBarImage
    }

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="8" fill="white" opacity="0.95" />
        <path d="M5.5 9.2L7.8 11.5L12.5 6.8" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      </svg>
    `.trim()

    this.defaultMenuBarImage = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
    )
    this.defaultMenuBarImage.setTemplateImage(true)
    return this.defaultMenuBarImage
  }

  private emitMenuBarAction(event: NativeMenuBarActionEvent): void {
    const launcherWindow = this.getLauncherWindow()
    if (!launcherWindow || launcherWindow.isDestroyed()) {
      return
    }

    launcherWindow.webContents.send("nativeMenuBar:itemSelected", event)
  }

  private buildMenuTemplate(state: NativeMenuBarState): Electron.MenuItemConstructorOptions[] {
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
            this.emitMenuBarAction({
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

  private getOrCreateTray(commandKey: string): Tray {
    const existingTray = this.trayByCommandKey.get(commandKey)
    if (existingTray) {
      return existingTray
    }

    const tray = new Tray(this.createDefaultMenuBarImage())
    tray.setIgnoreDoubleClickEvents(true)
    this.trayByCommandKey.set(commandKey, tray)
    return tray
  }
}
