import type { ExtensionRuntimeLaunchIntent } from "@shared/extension-runtime-protocol"
import type { NativeMenuBarState } from "@shared/native-menu-bar"
import { getDefaultExtensionRegistryService } from "../../extensions/registry/default-registry"
import type {
  NativeMenuBarActionHandlers,
  NativeMenuBarService
} from "../../native-menu-bar/service"
import { ExtensionRuntimeLifecycleError, type ExtensionRuntimeManager } from "./runtime-manager"

interface RuntimeMenuBarCommandState {
  activeLeaseGeneration: number
  attempt: number
  intent: ExtensionRuntimeLaunchIntent
  lastNativeActionHandlers?: NativeMenuBarActionHandlers
  lastNativeState?: NativeMenuBarState
  ownerGeneration: number
  phase: "active" | "recovering" | "starting" | "unavailable"
  remainingRevocationRetries: number
  sessionId: string | null
}

export class ExtensionRuntimeMenuBarService {
  private readonly commandStatesByKey = new Map<string, RuntimeMenuBarCommandState>()
  private disposed = false
  private readonly startGenerationByCommandKey = new Map<string, number>()
  private readonly manifestByName = new Map(
    getDefaultExtensionRegistryService()
      .listManifests(process.platform)
      .map((manifest) => [manifest.name, manifest])
  )
  private readonly stopListening: Array<() => void> = []

  constructor(
    private readonly runtimeManager: ExtensionRuntimeManager,
    private readonly nativeMenuBarService: NativeMenuBarService,
    private readonly runtimeCommandIntents?: readonly ExtensionRuntimeLaunchIntent[]
  ) {}

  start(): void {
    this.disposed = false
    this.stopListening.push(
      this.runtimeManager.onSurface((surface, session) => {
        if (surface.kind !== "menu-bar") {
          return
        }

        const commandKey = getCommandKey(surface.extensionName, surface.commandName)
        if (this.commandStatesByKey.get(commandKey)?.sessionId !== session.sessionId) {
          return
        }
        const nativeState = {
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
        } satisfies NativeMenuBarState
        const nativeActionHandlers = Object.fromEntries(
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
        const state = this.commandStatesByKey.get(commandKey)
        if (!state) {
          return
        }
        state.lastNativeState = nativeState
        state.lastNativeActionHandlers = nativeActionHandlers
        if (state.phase !== "recovering") {
          this.nativeMenuBarService.setState(nativeState, nativeActionHandlers)
        }
      }),
      this.runtimeManager.onIssueSnapshot((snapshot) => {
        for (const [commandKey, state] of this.commandStatesByKey) {
          if (state.sessionId !== snapshot.sessionId || snapshot.terminal) {
            continue
          }
          if (snapshot.issues.length === 0) {
            if (state.phase === "recovering") {
              state.phase = "active"
              if (state.lastNativeState) {
                this.nativeMenuBarService.setState(
                  state.lastNativeState,
                  state.lastNativeActionHandlers
                )
              } else {
                this.nativeMenuBarService.clearState(commandKey)
              }
            }
            return
          }

          const discardIssues = snapshot.issues.filter(
            (issue) => issue.recovery.strategy === "discard-value"
          )
          if (discardIssues.length !== snapshot.issues.length) {
            this.showRecoveryFailure(
              commandKey,
              state,
              "Stored values require a recovery action that is unavailable in the menu bar."
            )
            return
          }

          state.phase = "recovering"
          this.nativeMenuBarService.setState(
            {
              commandKey,
              iconName: "bell",
              sections: [
                {
                  items: discardIssues.map((issue) => ({
                    id: issue.id,
                    subtitle: issue.recovery.key,
                    title: "Discard stored value"
                  }))
                }
              ],
              title: state.intent.commandName,
              tooltip: "Stored values need attention"
            },
            Object.fromEntries(
              discardIssues.map(
                (issue) =>
                  [
                    issue.id,
                    () => {
                      void this.discardStorageIssue(commandKey, state, snapshot.sessionId, issue.id)
                    }
                  ] as const
              )
            )
          )
          return
        }
      }),
      this.runtimeManager.onError(({ error, sessionId }) => {
        if (error.code === "runtime_configuration_revoked") {
          return
        }
        for (const [commandKey, state] of this.commandStatesByKey) {
          if (state.sessionId === sessionId) {
            const isStorageRecoveryFailure = error.code === "storage_issue_discard_failed"
            this.showRecoveryFailure(
              commandKey,
              state,
              isStorageRecoveryFailure
                ? "The stored value could not be discarded."
                : "The extension menu bar stopped unexpectedly. Reload the extension to continue.",
              isStorageRecoveryFailure ? "Storage recovery unavailable" : "Extension unavailable"
            )
            return
          }
        }
      }),
      this.runtimeManager.onSessionStopped((session, reason) => {
        for (const [commandKey, state] of this.commandStatesByKey) {
          if (state.sessionId !== session.sessionId) {
            continue
          }

          state.sessionId = null
          if (state.phase === "unavailable") {
            return
          }
          this.nativeMenuBarService.clearState(commandKey)
          if (reason === "configuration-revoked") {
            if (!this.retryRevokedCommand(commandKey, state, state.attempt)) {
              this.commandStatesByKey.delete(commandKey)
            }
          } else {
            this.commandStatesByKey.delete(commandKey)
          }
          return
        }
      })
    )

    for (const intent of this.listRuntimeMenuBarCommandIntents()) {
      this.startCommand(intent)
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const stop of this.stopListening.splice(0)) {
      stop()
    }

    for (const [commandKey, state] of this.commandStatesByKey) {
      this.startGenerationByCommandKey.set(
        commandKey,
        (this.startGenerationByCommandKey.get(commandKey) ?? 0) + 1
      )
      if (state.sessionId) {
        this.runtimeManager.stopSessionById(state.sessionId)
      }
      this.nativeMenuBarService.clearState(commandKey)
    }
    this.commandStatesByKey.clear()
  }

  private listRuntimeMenuBarCommandIntents(): ExtensionRuntimeLaunchIntent[] {
    if (this.runtimeCommandIntents) {
      return [...this.runtimeCommandIntents]
    }

    return Array.from(this.manifestByName.values()).flatMap((manifest) =>
      manifest.commands
        .filter((command) => command.runtime && command.mode === "menu-bar")
        .map((command) => ({
          commandName: command.name,
          extensionName: manifest.name,
          initialAction: "open" as const,
          seedQuery: ""
        }))
    )
  }

  private async discardStorageIssue(
    commandKey: string,
    state: RuntimeMenuBarCommandState,
    sessionId: string,
    issueId: string
  ): Promise<void> {
    let discarded = false
    try {
      discarded = await this.runtimeManager.discardStorageIssue(sessionId, issueId)
    } catch {
      discarded = false
    }
    if (
      discarded ||
      this.commandStatesByKey.get(commandKey) !== state ||
      state.sessionId !== sessionId ||
      state.phase !== "recovering"
    ) {
      return
    }
    this.showRecoveryFailure(
      commandKey,
      state,
      "The stored value could not be discarded. Reload the extension to try again."
    )
  }

  private showRecoveryFailure(
    commandKey: string,
    state: RuntimeMenuBarCommandState,
    message: string,
    title = "Storage recovery unavailable"
  ): void {
    state.phase = "unavailable"
    this.nativeMenuBarService.setState({
      commandKey,
      iconName: "bell",
      sections: [
        {
          items: [
            {
              disabled: true,
              id: "runtime-unavailable",
              subtitle: message,
              title
            }
          ]
        }
      ],
      title: state.intent.commandName,
      tooltip: message
    })
  }

  private startCommand(intent: ExtensionRuntimeLaunchIntent): void {
    const commandKey = getCommandKey(intent.extensionName, intent.commandName)
    const generation = (this.startGenerationByCommandKey.get(commandKey) ?? 0) + 1
    this.startGenerationByCommandKey.set(commandKey, generation)
    const state: RuntimeMenuBarCommandState = {
      activeLeaseGeneration: 0,
      attempt: 0,
      intent,
      ownerGeneration: generation,
      phase: "starting",
      remainingRevocationRetries: 1,
      sessionId: null
    }
    this.commandStatesByKey.set(commandKey, state)
    void this.startCommandAttempt(commandKey, state)
  }

  private async startCommandAttempt(
    commandKey: string,
    state: RuntimeMenuBarCommandState
  ): Promise<void> {
    if (this.disposed || this.commandStatesByKey.get(commandKey) !== state) {
      return
    }
    const attempt = state.attempt + 1
    state.attempt = attempt
    state.phase = "starting"
    state.sessionId = null

    try {
      const session = await this.runtimeManager.startAmbient(state.intent, {
        onSessionStart: (startedSession) => {
          if (
            this.disposed ||
            this.commandStatesByKey.get(commandKey) !== state ||
            state.attempt !== attempt
          ) {
            throw new Error(`Menu bar runtime command "${commandKey}" start was superseded.`)
          }
          state.sessionId = startedSession.sessionId
        }
      })
      if (
        this.disposed ||
        this.commandStatesByKey.get(commandKey) !== state ||
        state.attempt !== attempt ||
        state.sessionId !== session.sessionId
      ) {
        this.runtimeManager.stopSessionById(session.sessionId)
        if (this.commandStatesByKey.get(commandKey) === state && state.attempt === attempt) {
          this.commandStatesByKey.delete(commandKey)
          this.nativeMenuBarService.clearState(commandKey)
        }
        return
      }
      state.phase = "active"
      state.activeLeaseGeneration += 1
      state.remainingRevocationRetries = 1
    } catch (error) {
      if (
        !this.disposed &&
        this.commandStatesByKey.get(commandKey) === state &&
        state.attempt === attempt
      ) {
        if (
          error instanceof ExtensionRuntimeLifecycleError &&
          error.code === "runtime_configuration_revoked"
        ) {
          if (this.retryRevokedCommand(commandKey, state, attempt)) {
            return
          }
        }
        this.commandStatesByKey.delete(commandKey)
        console.error(
          `[jingle:extension-runtime] Failed to start menu bar command "${commandKey}" owner ${state.ownerGeneration}, active lease ${state.activeLeaseGeneration}, attempt ${attempt}`,
          error
        )
      }
    }
  }

  private retryRevokedCommand(
    commandKey: string,
    state: RuntimeMenuBarCommandState,
    attempt: number
  ): boolean {
    if (
      this.disposed ||
      this.commandStatesByKey.get(commandKey) !== state ||
      state.attempt !== attempt ||
      state.remainingRevocationRetries <= 0
    ) {
      return false
    }

    state.remainingRevocationRetries -= 1
    void this.startCommandAttempt(commandKey, state)
    return true
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
  return JSON.stringify([extensionName, commandName])
}
