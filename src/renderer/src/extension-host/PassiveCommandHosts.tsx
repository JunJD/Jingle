import { useEffect, useMemo, useState, type ComponentType } from "react"
import type { LauncherCommandAddress, LauncherCommandOpenOptions } from "@launcher-shell/pages/types"
import { NativeExtensionHostProvider } from "./NativeExtensionHost"
import { nativeExtensionCommandEntries } from "./index"

function PassiveCommandHost(props: {
  commandName: string
  Component: ComponentType
  extensionCapabilities: readonly string[]
  extensionName: string
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}): React.JSX.Element | null {
  const { commandName, Component, extensionCapabilities, extensionName, openCommand } = props
  const [commandPreferences, setCommandPreferences] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadPreferences = (): void => {
      void window.api.nativeExtensions
        .getCommandPreferences(extensionName, commandName)
        .then((preferences) => {
          if (!cancelled) {
            setCommandPreferences(preferences)
          }
        })
        .catch((error) => {
          console.error(
            `[Native Extension] Failed to load passive command preferences for ${extensionName}:${commandName}`,
            error
          )
        })
    }

    loadPreferences()
    const unsubscribe = window.api.nativeExtensions.onPreferencesChanged((event) => {
      if (event.extensionName !== extensionName) {
        return
      }

      if (event.scope === "command" && event.commandName !== commandName) {
        return
      }

      loadPreferences()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [commandName, extensionName])

  const hostValue = useMemo(
    () => {
      if (!commandPreferences) {
        return null
      }

      const navigationEnabled = extensionCapabilities.includes("navigation")
      return {
        capabilities: extensionCapabilities as readonly (
          | "clipboard"
          | "navigation"
          | "rpc"
          | "surface"
          | "threads"
        )[],
        commandName,
        commandPreferences,
        initialAction: "focus" as const,
        navigation: navigationEnabled
          ? {
              goHome: () => {
                throw new Error(
                  `Native extension "${extensionName}" command "${commandName}" cannot call navigation.goHome() from a passive host`
                )
              },
              hideLauncher: () => window.api.launcher.hide(),
              openCommand
            }
          : undefined,
        extensionName,
        seedQuery: ""
      }
    },
    [commandName, commandPreferences, extensionCapabilities, extensionName, openCommand]
  )

  if (!hostValue) {
    return null
  }

  return (
    <NativeExtensionHostProvider value={hostValue}>
      <Component />
    </NativeExtensionHostProvider>
  )
}

export function NativeExtensionPassiveCommandHosts(props: {
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}): React.JSX.Element {
  const { openCommand } = props
  const commands = useMemo(
    () =>
      nativeExtensionCommandEntries.filter(
        (entry) => entry.command.mode === "background" || entry.command.mode === "menu-bar"
      ),
    []
  )

  return (
    <>
      {commands.map((entry) => {
        const Component = entry.module.default as ComponentType | undefined
        if (!Component) {
          throw new Error(
            `Native extension "${entry.extensionName}" passive command "${entry.command.name}" must export a default component`
          )
        }

        return (
          <PassiveCommandHost
            key={`${entry.extensionName}:${entry.command.name}`}
            commandName={entry.command.name}
            Component={Component}
            extensionCapabilities={entry.extensionCapabilities}
            extensionName={entry.extensionName}
            openCommand={openCommand}
          />
        )
      })}
    </>
  )
}
