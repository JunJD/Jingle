import type { AppLocale } from "@shared/i18n"
import type { NativeMenuBarState } from "@shared/native-menu-bar"
import { getDefaultExtensionRegistryService } from "../../extensions/registry/default-registry"
import type { NativeMenuBarService } from "../../native-menu-bar/service"
import type { ExtensionRuntimeHostCapabilities, ExtensionRuntimeManager } from "./runtime-manager"

export class ExtensionRuntimeMenuBarService {
  private readonly sessionIdsByCommandKey = new Map<string, string>()
  private readonly manifestByName = new Map(
    getDefaultExtensionRegistryService()
      .listManifests(process.platform)
      .map((manifest) => [manifest.name, manifest])
  )
  private readonly stopListening: Array<() => void> = []

  constructor(
    private readonly runtimeManager: ExtensionRuntimeManager,
    private readonly host: ExtensionRuntimeHostCapabilities,
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
            extensionIcon: this.getPackageMenuBarIcon(
              surface.extensionName,
              surface.icon ?? this.manifestByName.get(surface.extensionName)?.icon
            ),
            iconName: surface.iconName,
            isLoading: surface.isLoading,
            sections: surface.sections.map((section) => ({
              items: section.items.map((item) => {
                const { icon, ...nativeItem } = item
                return {
                  ...nativeItem,
                  extensionIcon: this.getPackageMenuBarIcon(surface.extensionName, icon)
                }
              }),
              title: section.title
            })),
            title: surface.title,
            tooltip: surface.tooltip
          } satisfies NativeMenuBarState,
          Object.fromEntries(
            surface.sections.flatMap((section) =>
              section.items
                .filter((item) => !item.disabled)
                .map(
                  (item) =>
                    [
                      item.id,
                      () => {
                        this.runtimeManager.sendEvent(session.sessionId, {
                          itemId: item.id,
                          type: "menu-bar.item.execute"
                        })
                      }
                    ] as const
                )
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
    const commands = Array.from(this.manifestByName.values()).flatMap((manifest) =>
      manifest.commands
        .filter((command) => command.runtime && command.mode === "menu-bar")
        .map((command) => ({ command, manifest }))
    )

    await Promise.all(
      commands.map(async ({ command, manifest }) => {
        const session = await this.runtimeManager.startAmbient({
          commandName: command.name,
          commandPreferences: await this.host.getCommandPreferences({
            commandName: command.name,
            extensionName: manifest.name
          }),
          extensionName: manifest.name,
          extensionPreferences: await this.host.getExtensionPreferences(manifest.name),
          initialAction: "open",
          locale: this.getLocale(),
          mode: "menu-bar",
          seedQuery: ""
        })
        this.sessionIdsByCommandKey.set(
          getCommandKey(manifest.name, command.name),
          session.sessionId
        )
      })
    )
  }

  private getPackageMenuBarIcon(
    extensionName: string,
    icon: string | undefined
  ): NativeMenuBarState["extensionIcon"] | undefined {
    if (!icon) {
      return undefined
    }

    return {
      extensionName,
      path: icon
    }
  }
}

function getCommandKey(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
}
