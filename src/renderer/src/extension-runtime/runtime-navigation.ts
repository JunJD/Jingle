import type {
  ExtensionRuntimeNavigationRequestEvent,
  ExtensionRuntimeNavigationResponse
} from "@shared/extension-runtime-protocol"
import type {
  LauncherCommandAddress,
  LauncherCommandOpenOptions
} from "@launcher-shell/pages/types"

type RuntimeNavigationTarget = {
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}

interface RuntimeNavigationRequestOptions {
  completeOpenCommandBeforeNavigation?: boolean
}

function getRuntimeNavigationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function completeRuntimeNavigationRequest(
  response: ExtensionRuntimeNavigationResponse
): Promise<void> {
  await window.api.extensionRuntime.completeNavigationRequest(response)
}

export async function handleRuntimeNavigationRequest(
  event: ExtensionRuntimeNavigationRequestEvent,
  navigation: RuntimeNavigationTarget,
  options: RuntimeNavigationRequestOptions = {}
): Promise<void> {
  const { request, sessionId } = event
  const okResponse: ExtensionRuntimeNavigationResponse = {
    ok: true,
    requestId: request.id,
    sessionId
  }

  try {
    switch (request.method) {
      case "go-home":
        await completeRuntimeNavigationRequest(okResponse)
        navigation.goHome()
        return
      case "hide-launcher":
        await navigation.hideLauncher()
        await completeRuntimeNavigationRequest(okResponse)
        return
      case "open-command":
        if (!request.payload) {
          throw new Error("Runtime navigation open-command request is missing a payload.")
        }

        if (request.payload.showLauncher) {
          await window.api.launcher.show()
        }

        if (options.completeOpenCommandBeforeNavigation ?? true) {
          await completeRuntimeNavigationRequest(okResponse)
          navigation.openCommand(
            {
              commandName: request.payload.commandName,
              extensionName: request.payload.extensionName,
              kind: "extension-command"
            },
            {
              launchProps: request.payload.launchProps
            }
          )
          return
        }

        navigation.openCommand(
          {
            commandName: request.payload.commandName,
            extensionName: request.payload.extensionName,
            kind: "extension-command"
          },
          {
            launchProps: request.payload.launchProps
          }
        )
        await completeRuntimeNavigationRequest(okResponse)
        return
    }
  } catch (error) {
    await completeRuntimeNavigationRequest({
      error: {
        code: "navigation_failed",
        message: getRuntimeNavigationErrorMessage(error)
      },
      ok: false,
      requestId: request.id,
      sessionId
    })
  }
}
