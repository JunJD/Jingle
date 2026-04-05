import { globalShortcut } from "electron"
import { resolveShortcutPlatform } from "../../../shared/shortcuts/model"
import {
  listGlobalShortcutAvailability,
  resolveShortcutBindings,
  type GlobalShortcutAvailability,
  type ResolvedShortcutBinding
} from "../../../shared/shortcuts/settings"
import { getShortcutSettings } from "../../preferences"
import { toElectronAccelerator } from "./global-shortcut-adapter"

type ResolvedGlobalShortcutBinding = ResolvedShortcutBinding & { scope: "global" }

const registeredAccelerators = new Set<string>()
let availabilityCache: GlobalShortcutAvailability[] = []

function getResolvedGlobalShortcutBindings(): ResolvedGlobalShortcutBinding[] {
  return resolveShortcutBindings(
    getShortcutSettings(),
    resolveShortcutPlatform(process.platform)
  ).filter((binding): binding is ResolvedGlobalShortcutBinding => binding.scope === "global")
}

function createAvailabilityRecord(
  binding: ResolvedGlobalShortcutBinding,
  params: {
    accelerator: string | null
    reason?: string
    state: GlobalShortcutAvailability["state"]
  }
): GlobalShortcutAvailability {
  const { accelerator, reason, state } = params

  return {
    accelerator,
    chord: binding.chord,
    commandId: binding.commandId,
    ...(binding.platform ? { platform: binding.platform } : {}),
    ...(reason ? { reason } : {}),
    scope: "global",
    state
  }
}

export function registerGlobalShortcutService(params: {
  onCommand: (commandId: string) => void
}): void {
  const { onCommand } = params
  unregisterGlobalShortcutService()

  const bindings = getResolvedGlobalShortcutBindings()
  availabilityCache = bindings.map((binding) => {
    const accelerator = toElectronAccelerator(binding.chord)
    if (!accelerator) {
      return createAvailabilityRecord(binding, {
        accelerator: null,
        reason: "Unsupported accelerator chord",
        state: "unavailable"
      })
    }

    const registered = globalShortcut.register(accelerator, () => {
      onCommand(binding.commandId)
    })

    if (registered) {
      registeredAccelerators.add(accelerator)
    }

    return createAvailabilityRecord(binding, {
      accelerator,
      ...(registered
        ? { state: "available" as const }
        : {
            reason: `Electron could not register accelerator "${accelerator}"`,
            state: "unavailable" as const
          })
    })
  })
}

export function unregisterGlobalShortcutService(): void {
  for (const accelerator of registeredAccelerators) {
    globalShortcut.unregister(accelerator)
  }

  registeredAccelerators.clear()
  availabilityCache = listGlobalShortcutAvailability(getResolvedGlobalShortcutBindings())
}

export function getGlobalShortcutAvailability(): GlobalShortcutAvailability[] {
  if (availabilityCache.length > 0) {
    return availabilityCache
  }

  return listGlobalShortcutAvailability(getResolvedGlobalShortcutBindings())
}

export function getGlobalShortcutAccelerator(commandId: string): string | null {
  const binding = getResolvedGlobalShortcutBindings().find((entry) => entry.commandId === commandId)
  return binding ? toElectronAccelerator(binding.chord) : null
}
