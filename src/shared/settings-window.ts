import { z } from "zod/v4"
import type { ProviderId } from "./app-types"

export const SETTINGS_NAVIGATION_CHANGED_CHANNEL = "settings:navigationChanged"

export interface SettingsWindowTarget {
  commandName?: string
  extensionName?: string
  providerId?: ProviderId
}

const nonEmptyStringSchema = z.string().trim().min(1)
const extensionTargetSchema = z
  .object({
    commandName: nonEmptyStringSchema.optional(),
    extensionName: nonEmptyStringSchema
  })
  .strict()
const providerTargetSchema = z
  .object({
    providerId: nonEmptyStringSchema
  })
  .strict()

const settingsWindowNavigationVariants = [
  z.object({ tab: z.literal("general") }).strict(),
  z.object({ tab: z.literal("appearance") }).strict(),
  z.object({ tab: z.literal("memory") }).strict(),
  z.object({ tab: z.literal("archived") }).strict(),
  z.object({ tab: z.literal("provider"), target: providerTargetSchema.optional() }).strict(),
  z.object({ tab: z.literal("extensions"), target: extensionTargetSchema.optional() }).strict(),
  z.object({ tab: z.literal("quicklinks") }).strict(),
  z.object({ tab: z.literal("shortcuts") }).strict()
] as const

export const settingsWindowNavigationPayloadSchema = z.discriminatedUnion(
  "tab",
  settingsWindowNavigationVariants
)

export type SettingsWindowNavigationPayload = z.infer<typeof settingsWindowNavigationPayloadSchema>
export type SettingsWindowTab = SettingsWindowNavigationPayload["tab"]
export type ProviderSettingsWindowTarget = NonNullable<
  Extract<SettingsWindowNavigationPayload, { tab: "provider" }>["target"]
>
export type ExtensionSettingsWindowTarget = NonNullable<
  Extract<SettingsWindowNavigationPayload, { tab: "extensions" }>["target"]
>

export const SETTINGS_WINDOW_TABS: readonly SettingsWindowTab[] =
  settingsWindowNavigationVariants.map((variant) => variant.shape.tab.value)

export const settingsWindowOpenArgsSchema = z.union([
  z.tuple([]),
  z.tuple([settingsWindowNavigationPayloadSchema])
])

export const settingsWindowOpenTabArgsSchema = z.tuple([settingsWindowNavigationPayloadSchema])

export const settingsWindowGetPendingNavigationArgsSchema = z.tuple([])

export function createSettingsWindowNavigationPayload(
  tab: SettingsWindowTab,
  target?: SettingsWindowTarget
): SettingsWindowNavigationPayload {
  return settingsWindowNavigationPayloadSchema.parse({
    tab,
    ...(target ? { target } : {})
  })
}
