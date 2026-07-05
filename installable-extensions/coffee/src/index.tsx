import { useCallback, useEffect, useMemo, useState } from "react"
import { MenuBarExtra, useInterval } from "@jingle/extension-api"
import type { CoffeeIconSet, CoffeeStatus } from "../contracts"
import {
  getCoffeeStatus,
  stopCoffee,
  toggleCoffee,
  useCoffeeCommandPreferences,
  useCoffeePreferences
} from "./runtime-client"

interface CoffeeMenuBarPreferences {
  hiddenWhenDecaffeinated?: boolean
}

function resolveCoffeeIcon(icon: CoffeeIconSet | undefined, isRunning: boolean): string {
  return `assets/${icon ?? "pot"}-${isRunning ? "filled" : "empty"}.png`
}

export default function CoffeeMenuBar(): React.JSX.Element | null {
  const extensionPreferences = useCoffeePreferences()
  const commandPreferences = useCoffeeCommandPreferences<CoffeeMenuBarPreferences>()
  const [status, setStatus] = useState<CoffeeStatus>({
    isRunning: false,
    secondsRemaining: null,
    timeRemaining: null
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const nextStatus = await getCoffeeStatus()
      if (!signal?.aborted) {
        setStatus(nextStatus)
      }
    } catch (nextError) {
      if (!signal?.aborted) {
        setError(nextError instanceof Error ? nextError.message : "Failed to refresh Coffee status")
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)

    return () => {
      controller.abort()
    }
  }, [refresh])

  useInterval(refresh, 60_000)

  const icon = useMemo(
    () => resolveCoffeeIcon(extensionPreferences.icon, status.isRunning),
    [extensionPreferences.icon, status.isRunning]
  )

  if (commandPreferences.hiddenWhenDecaffeinated && !status.isRunning && !isLoading && !error) {
    return null
  }

  return (
    <MenuBarExtra icon={icon} isLoading={isLoading} tooltip="Coffee">
      <MenuBarExtra.Section
        title={`Your Mac is ${status.isRunning ? "caffeinated" : "decaffeinated"}`}
      />
      {status.isRunning && status.timeRemaining ? (
        <MenuBarExtra.Section title={status.timeRemaining} />
      ) : null}
      {error ? (
        <MenuBarExtra.Section title="Coffee">
          <MenuBarExtra.Item
            disabled
            iconName="refresh"
            subtitle={error}
            title="Refresh failed"
            onAction={() => {}}
          />
        </MenuBarExtra.Section>
      ) : null}
      <MenuBarExtra.Section title="Actions">
        <MenuBarExtra.Item
          icon={icon}
          title={status.isRunning ? "Decaffeinate" : "Caffeinate"}
          onAction={() => {
            void toggleCoffee()
              .then(setStatus)
              .catch((nextError) => {
                setError(nextError instanceof Error ? nextError.message : "Failed to toggle Coffee")
              })
          }}
        />
        <MenuBarExtra.Item
          iconName="refresh"
          title="Refresh"
          onAction={() => {
            void refresh()
          }}
        />
        {status.isRunning ? (
          <MenuBarExtra.Item
            iconName="check"
            title="Stop Coffee"
            onAction={() => {
              void stopCoffee()
                .then(setStatus)
                .catch((nextError) => {
                  setError(nextError instanceof Error ? nextError.message : "Failed to stop Coffee")
                })
            }}
          />
        ) : null}
      </MenuBarExtra.Section>
    </MenuBarExtra>
  )
}
