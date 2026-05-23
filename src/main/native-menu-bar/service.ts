import { existsSync } from "node:fs"
import { join } from "node:path"
import { BrowserWindow, Menu, Tray, nativeImage } from "electron"
import type { NativeMenuBarActionEvent, NativeMenuBarState } from "@shared/native-menu-bar"

interface NativeMenuBarBddProbe {
  clearState: (commandKey: string) => void
  getStates: () => NativeMenuBarState[]
  selectItem: (event: NativeMenuBarActionEvent) => void
  setState: (state: NativeMenuBarState) => void
}

const BDD_NATIVE_MENU_BAR_PROBE_KEY = "__OPENWORK_BDD_NATIVE_MENU_BAR__"
const MENU_BAR_ITEM_ICON_SIZE = 16
const MENU_BAR_STATUS_ICON_SIZE = 18

export type NativeMenuBarActionHandlers = Record<string, () => void>

export class NativeMenuBarService {
  private readonly stateByCommandKey = new Map<string, NativeMenuBarState>()
  private readonly trayByCommandKey = new Map<string, Tray>()
  private getLauncherWindow: () => BrowserWindow | null = () => null
  private readonly menuBarImageByName = new Map<string, Electron.NativeImage>()
  private readonly nativeActionByEventKey = new Map<string, () => void>()
  private readonly nativeActionItemIdsByCommandKey = new Map<string, Set<string>>()

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
    this.nativeActionByEventKey.clear()
    this.nativeActionItemIdsByCommandKey.clear()
    this.detachBddProbe()
  }

  setState(state: NativeMenuBarState, nativeActionHandlers?: NativeMenuBarActionHandlers): void {
    const tray = this.getOrCreateTray(state.commandKey)

    this.stateByCommandKey.set(state.commandKey, this.cloneState(state))
    this.setNativeActionHandlers(state.commandKey, nativeActionHandlers)
    tray.setImage(
      state.iconName
        ? this.createMenuBarImage(state.iconName, MENU_BAR_STATUS_ICON_SIZE)
        : this.createMenuBarImage(state.extensionIcon, MENU_BAR_STATUS_ICON_SIZE)
    )
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
    this.setNativeActionHandlers(commandKey)
  }

  getStateSnapshot(): NativeMenuBarState[] {
    return Array.from(this.stateByCommandKey.values(), (state) => this.cloneState(state))
  }

  emitSelectionForTesting(event: NativeMenuBarActionEvent): void {
    if (!this.stateByCommandKey.has(event.commandKey)) {
      throw new Error(`Native menu bar command not found: ${event.commandKey}`)
    }

    this.selectItem(event)
  }

  private createEventKey(commandKey: string, itemId: string): string {
    return `${commandKey}:${itemId}`
  }

  private attachBddProbe(): void {
    ;(
      globalThis as typeof globalThis & {
        [BDD_NATIVE_MENU_BAR_PROBE_KEY]?: NativeMenuBarBddProbe
      }
    )[BDD_NATIVE_MENU_BAR_PROBE_KEY] = {
      clearState: (commandKey) => this.clearState(commandKey),
      getStates: () => this.getStateSnapshot(),
      selectItem: (event) => this.emitSelectionForTesting(event),
      setState: (state) => this.setState(state)
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

  private setNativeActionHandlers(
    commandKey: string,
    handlers?: NativeMenuBarActionHandlers
  ): void {
    const existingItemIds = this.nativeActionItemIdsByCommandKey.get(commandKey)
    if (existingItemIds) {
      for (const itemId of existingItemIds) {
        this.nativeActionByEventKey.delete(this.createEventKey(commandKey, itemId))
      }
      this.nativeActionItemIdsByCommandKey.delete(commandKey)
    }

    if (!handlers) {
      return
    }

    const itemIds = new Set<string>()
    for (const [itemId, handler] of Object.entries(handlers)) {
      this.nativeActionByEventKey.set(this.createEventKey(commandKey, itemId), handler)
      itemIds.add(itemId)
    }
    this.nativeActionItemIdsByCommandKey.set(commandKey, itemIds)
  }

  private createMenuBarImage(
    icon: NativeMenuBarState["extensionIcon"] | NativeMenuBarState["iconName"] = "openwork",
    size: number
  ): Electron.NativeImage {
    const cacheKey =
      typeof icon === "string" ? `${icon}:${size}` : `${icon.extensionName}:${icon.path}:${size}`
    const cachedImage = this.menuBarImageByName.get(cacheKey)
    if (cachedImage) {
      return cachedImage
    }

    const iconPath =
      typeof icon === "string"
        ? join(__dirname, "../../resources/assets/menu-bar", `${icon}.png`)
        : join(__dirname, "../../resources/extensions", icon.extensionName, icon.path)
    if (!existsSync(iconPath)) {
      throw new Error(`Native menu bar icon not found: ${iconPath}`)
    }

    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      throw new Error(`Native menu bar icon is empty: ${iconPath}`)
    }

    const resizedImage = nativeImage.createEmpty()
    for (const scaleFactor of [1, 2]) {
      const scaledSize = size * scaleFactor
      resizedImage.addRepresentation({
        dataURL: image
          .resize({ height: scaledSize, quality: "best", width: scaledSize })
          .toDataURL(),
        scaleFactor
      })
    }

    resizedImage.setTemplateImage(true)
    this.menuBarImageByName.set(cacheKey, resizedImage)
    return resizedImage
  }

  private emitMenuBarAction(event: NativeMenuBarActionEvent): void {
    const launcherWindow = this.getLauncherWindow()
    if (!launcherWindow || launcherWindow.isDestroyed()) {
      return
    }

    launcherWindow.webContents.send("nativeMenuBar:itemSelected", event)
  }

  private selectItem(event: NativeMenuBarActionEvent): void {
    const nativeAction = this.nativeActionByEventKey.get(
      this.createEventKey(event.commandKey, event.itemId)
    )
    if (nativeAction) {
      nativeAction()
      return
    }

    this.emitMenuBarAction(event)
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
            this.selectItem({
              commandKey: state.commandKey,
              itemId: item.id
            })
          },
          enabled: item.disabled !== true,
          icon: item.iconName
            ? this.createMenuBarImage(item.iconName, MENU_BAR_ITEM_ICON_SIZE)
            : undefined,
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

    const tray = new Tray(this.createMenuBarImage("openwork", MENU_BAR_STATUS_ICON_SIZE))
    tray.setIgnoreDoubleClickEvents(true)
    this.trayByCommandKey.set(commandKey, tray)
    return tray
  }
}
