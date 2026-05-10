import type { AppLocale } from "@shared/i18n"
import type { NativeMenuBarState } from "@shared/native-menu-bar"
import { listNativeExtensionManifests } from "@extensions/index"
import type { NativeMenuBarService } from "../../native-menu-bar/service"
import type { ExtensionRuntimeManager } from "./runtime-manager"

export class ExtensionRuntimeMenuBarService {
  private readonly sessionIdsByCommandKey = new Map<string, string>()
  private readonly stopListening: Array<() => void> = []

  constructor(
    private readonly runtimeManager: ExtensionRuntimeManager,
    private readonly nativeMenuBarService: NativeMenuBarService,
    private readonly getLocale: () => AppLocale
  ) {}

  start(): void {
    this.stopListening.push(
      this.runtimeManager.onSurface((surface, session) => {
        if (surface.kind !== "menu-bar") {
          return
        }

        const commandKey = getCommandKey(surface.extensionName, surface.commandName)
        this.nativeMenuBarService.setState(
          {
            commandKey,
            iconName: surface.iconName,
            isLoading: surface.isLoading,
            sections: surface.sections.map((section) => ({
              items: section.items,
              title: section.title
            })),
            title: surface.title,
            tooltip: surface.tooltip
          } satisfies NativeMenuBarState,
          Object.fromEntries(
            surface.sections.flatMap((section) =>
              section.items
                .filter((item) => !item.disabled)
                .map((item) => [
                  item.id,
                  () => {
                    this.runtimeManager.sendEvent(session.sessionId, {
                      itemId: item.id,
                      type: "menu-bar.item.execute"
                    })
                  }
                ])
            )
          )
        )
      }),
      this.runtimeManager.onError((error) => {
        const sessionId = error.sessionId
        for (const [commandKey, ambientSessionId] of this.sessionIdsByCommandKey) {
          if (ambientSessionId !== sessionId) {
            continue
          }

          this.sessionIdsByCommandKey.delete(commandKey)
          this.nativeMenuBarService.clearState(commandKey)
        }
      })
    )

    void this.startRuntimeMenuBarCommands()
  }

  dispose(): void {
    for (const stop of this.stopListening.splice(0)) {
      stop()
    }

    for (const commandKey of this.sessionIdsByCommandKey.keys()) {
      this.nativeMenuBarService.clearState(commandKey)
    }
    this.sessionIdsByCommandKey.clear()
  }

  private async startRuntimeMenuBarCommands(): Promise<void> {
    for (const manifest of listNativeExtensionManifests(process.platform)) {
      for (const command of manifest.commands) {
        if (!command.runtime || command.mode !== "menu-bar") {
          continue
        }

        const session = await this.runtimeManager.startAmbient({
          commandName: command.name,
          commandPreferences: {},
          extensionName: manifest.name,
          extensionPreferences: {},
          initialAction: "open",
          locale: this.getLocale(),
          mode: "menu-bar",
          seedQuery: ""
        })
        this.sessionIdsByCommandKey.set(getCommandKey(manifest.name, command.name), session.sessionId)
      }
    }
  }
}

function getCommandKey(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
}
