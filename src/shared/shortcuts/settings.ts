import { isShortcutCommandConfigurable } from "./configurable"
import { listDefaultShortcutBindings } from "./defaults"
import {
  normalizeShortcutChord,
  type ShortcutBindingDefinition,
  type ShortcutChord,
  type ShortcutPlatform,
  type ShortcutScope
} from "./model"

export interface ShortcutOverride {
  commandId: string
  chord?: ShortcutChord
  disabled?: boolean
  platform?: ShortcutPlatform
}

export interface ShortcutSettings {
  overrides: ShortcutOverride[]
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  overrides: []
}

export type ResolvedShortcutBindingSource = "default" | "override"

export interface ResolvedShortcutBinding extends ShortcutBindingDefinition {
  source: ResolvedShortcutBindingSource
}

export type ShortcutConflictState = "ok" | "shadowed" | "conflict"

export interface ShortcutBindingConflict {
  chord: ShortcutChord
  commandId: string
  competingCommandId: string
  competingScope: ShortcutScope
  scope: ShortcutScope
  state: Exclude<ShortcutConflictState, "ok">
}

export type GlobalShortcutAvailabilityState = "unknown" | "available" | "unavailable"

export interface GlobalShortcutAvailability {
  accelerator: string | null
  chord: ShortcutChord
  commandId: string
  platform?: ShortcutPlatform
  reason?: string
  scope: "global"
  state: GlobalShortcutAvailabilityState
}

function isShortcutPlatform(value: unknown): value is ShortcutPlatform {
  return value === "darwin" || value === "win32" || value === "linux"
}

function normalizeShortcutOverride(value: unknown): ShortcutOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const partial = value as Partial<ShortcutOverride>
  const commandId = typeof partial.commandId === "string" ? partial.commandId.trim() : ""
  if (!commandId) {
    return null
  }
  if (!isShortcutCommandConfigurable(commandId)) {
    return null
  }

  const chord =
    partial.chord && typeof partial.chord === "object" && !Array.isArray(partial.chord)
      ? normalizeShortcutChord(partial.chord)
      : undefined
  const disabled = partial.disabled === true
  const platform = isShortcutPlatform(partial.platform) ? partial.platform : undefined

  if (!chord && !disabled) {
    return null
  }

  return {
    commandId,
    ...(chord ? { chord } : {}),
    ...(disabled ? { disabled: true } : {}),
    ...(platform ? { platform } : {})
  }
}

function matchesShortcutPlatform(
  bindingPlatform: ShortcutPlatform | undefined,
  platform: ShortcutPlatform | undefined
): boolean {
  return bindingPlatform === undefined || platform === undefined || bindingPlatform === platform
}

function getOverrideKey(commandId: string, platform: ShortcutPlatform | undefined): string {
  return `${commandId}::${platform ?? "*"}`
}

function resolveShortcutOverride(
  overrides: readonly ShortcutOverride[],
  commandId: string,
  platform: ShortcutPlatform | undefined
): ShortcutOverride | null {
  const exactPlatformMatch =
    platform !== undefined
      ? overrides.find(
          (override) => override.commandId === commandId && override.platform === platform
        )
      : null

  if (exactPlatformMatch) {
    return exactPlatformMatch
  }

  return (
    overrides.find(
      (override) => override.commandId === commandId && override.platform === undefined
    ) ?? null
  )
}

function resolveShortcutBinding(
  binding: ShortcutBindingDefinition,
  overrides: readonly ShortcutOverride[],
  platform: ShortcutPlatform | undefined
): ResolvedShortcutBinding | null {
  if (!matchesShortcutPlatform(binding.platform, platform)) {
    return null
  }

  const override = resolveShortcutOverride(overrides, binding.commandId, platform)
  if (override && override.disabled) {
    return null
  }

  if (override && override.chord) {
    return {
      ...binding,
      chord: override.chord,
      source: "override"
    }
  }

  return {
    ...binding,
    source: "default"
  }
}

export function normalizeShortcutSettings(value: unknown): ShortcutSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SHORTCUT_SETTINGS
  }

  const partial = value as Partial<ShortcutSettings>
  const overrides = Array.isArray(partial.overrides) ? partial.overrides : []
  const normalizedOverrides = new Map<string, ShortcutOverride>()

  for (const override of overrides) {
    const normalized = normalizeShortcutOverride(override)
    if (!normalized) {
      continue
    }

    const key = getOverrideKey(normalized.commandId, normalized.platform)
    if (normalizedOverrides.has(key)) {
      normalizedOverrides.delete(key)
    }
    normalizedOverrides.set(key, normalized)
  }

  return {
    overrides: Array.from(normalizedOverrides.values())
  }
}

export function resolveShortcutBindings(
  settings: ShortcutSettings,
  platform?: ShortcutPlatform
): ResolvedShortcutBinding[] {
  const normalizedSettings = normalizeShortcutSettings(settings)

  return listDefaultShortcutBindings().flatMap((binding) => {
    const resolvedBinding = resolveShortcutBinding(
      binding,
      normalizedSettings.overrides,
      platform
    )
    if (!resolvedBinding) {
      return []
    }

    return [resolvedBinding]
  })
}

export function listGlobalShortcutAvailability(
  bindings: readonly ResolvedShortcutBinding[]
): GlobalShortcutAvailability[] {
  return bindings
    .filter(
      (binding): binding is ResolvedShortcutBinding & { scope: "global" } =>
        binding.scope === "global"
    )
    .map((binding) => ({
      accelerator: null,
      chord: binding.chord,
      commandId: binding.commandId,
      ...(binding.platform ? { platform: binding.platform } : {}),
      scope: "global" as const,
      state: "unknown" as const
    }))
}
