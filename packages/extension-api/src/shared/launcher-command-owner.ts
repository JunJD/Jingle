import type { ClipboardPayloadKind } from "./clipboard"
import type { LocalizedTextValue } from "./i18n"

export type LauncherCommandOwnerCapability =
  | "clipboard"
  | "navigation"
  | "rpc"
  | "surface"
  | "threads"

export type LauncherCommandMode = "view" | "no-view"

export interface LauncherCommandOwnerClipboardManifest {
  accepts: ClipboardPayloadKind[]
}

export type LauncherCommandArgumentType = "dropdown" | "password" | "text"

interface LauncherCommandArgumentBaseManifest {
  name: string
  placeholder?: LocalizedTextValue
  required?: boolean
  title: LocalizedTextValue
}

export type LauncherCommandArgumentManifest =
  | (LauncherCommandArgumentBaseManifest & {
      data: Array<{ title: LocalizedTextValue; value: string }>
      type: "dropdown"
    })
  | (LauncherCommandArgumentBaseManifest & {
      data?: never
      type?: "text"
    })
  | (LauncherCommandArgumentBaseManifest & {
      data?: never
      type: "password"
    })

export interface LauncherCommandManifest<TCommandName extends string = string> {
  arguments?: LauncherCommandArgumentManifest[]
  description?: LocalizedTextValue
  icon?: string
  iconName?: string
  keywords?: string[]
  mode: LauncherCommandMode
  name: TCommandName
  requiresLauncherArguments?: boolean
  title?: LocalizedTextValue
}

export interface LauncherCommandOwnerManifest<
  TOwnerId extends string = string,
  TCommandName extends string = string
> {
  capabilities: LauncherCommandOwnerCapability[]
  clipboard?: LauncherCommandOwnerClipboardManifest
  commands: Array<LauncherCommandManifest<TCommandName>>
  defaultCommandName: TCommandName
  displayName: LocalizedTextValue
  icon?: string
  id: TOwnerId
  rpcMethods?: string[]
}

export function hasLauncherCommandOwnerCapability(
  manifest: LauncherCommandOwnerManifest,
  capability: LauncherCommandOwnerCapability
): boolean {
  return manifest.capabilities.includes(capability)
}

export function validateLauncherCommandOwnerManifest(manifest: LauncherCommandOwnerManifest): void {
  const capabilitySet = new Set(manifest.capabilities)
  const commandNameSet = new Set<string>()
  const rpcMethods = manifest.rpcMethods ?? []
  const rpcMethodSet = new Set(rpcMethods)

  if (capabilitySet.size !== manifest.capabilities.length) {
    throw new Error(`Launcher command owner "${manifest.id}" declares duplicate capabilities`)
  }

  for (const command of manifest.commands) {
    if (commandNameSet.has(command.name)) {
      throw new Error(
        `Launcher command owner "${manifest.id}" declares duplicate command "${command.name}"`
      )
    }

    commandNameSet.add(command.name)

    const commandArguments = (command as { arguments?: unknown }).arguments
    const commandArgumentsField = `Launcher command owner "${manifest.id}" command "${command.name}" arguments`
    if (commandArguments !== undefined && !Array.isArray(commandArguments)) {
      throw new Error(`${commandArgumentsField} must be an array when declared`)
    }

    const argumentNameSet = new Set<string>()
    for (const [argumentIndex, argument] of (commandArguments ?? []).entries()) {
      const argumentField = `${commandArgumentsField}[${argumentIndex}]`
      assertNonEmptyString(argument.name, `${argumentField}.name must be non-empty`)
      if (argumentNameSet.has(argument.name)) {
        throw new Error(
          `Launcher command owner "${manifest.id}" command "${command.name}" declares duplicate argument "${argument.name}"`
        )
      }
      argumentNameSet.add(argument.name)

      assertNonEmptyLocalizedText(argument.title, `${argumentField}.title must be non-empty`)
      if (argument.placeholder !== undefined) {
        assertNonEmptyLocalizedText(
          argument.placeholder,
          `${argumentField}.placeholder must be non-empty when declared`
        )
      }

      if (argument.required !== undefined && typeof argument.required !== "boolean") {
        throw new Error(`${argumentField}.required must be a boolean when declared`)
      }

      const declaredArgumentType = (argument as { type?: unknown }).type
      const argumentType = declaredArgumentType === undefined ? "text" : declaredArgumentType
      if (argumentType !== "text" && argumentType !== "password" && argumentType !== "dropdown") {
        throw new Error(`${argumentField}.type "${String(declaredArgumentType)}" is not supported`)
      }

      if (argumentType !== "dropdown") {
        if (argument.data !== undefined) {
          throw new Error(`${argumentField}.data is only supported for dropdown arguments`)
        }
        continue
      }

      const argumentData = (argument as { data?: LauncherCommandArgumentManifest["data"] }).data
      if (!argumentData?.length) {
        throw new Error(`${argumentField}.data must declare at least one option`)
      }

      const optionValueSet = new Set<string>()
      for (const [optionIndex, option] of argumentData.entries()) {
        const optionField = `${argumentField}.data[${optionIndex}]`
        assertNonEmptyLocalizedText(option.title, `${optionField}.title must be non-empty`)
        assertNonEmptyString(option.value, `${optionField}.value must be non-empty`)
        if (optionValueSet.has(option.value)) {
          throw new Error(`${argumentField}.data declares duplicate value "${option.value}"`)
        }
        optionValueSet.add(option.value)
      }
    }

    if (command.requiresLauncherArguments && !commandArguments?.length) {
      throw new Error(
        `Launcher command owner "${manifest.id}" command "${command.name}" requires launcher arguments without declaring any argument schema`
      )
    }
  }

  if (!commandNameSet.has(manifest.defaultCommandName)) {
    throw new Error(
      `Launcher command owner "${manifest.id}" default command "${manifest.defaultCommandName}" is not declared in its manifest`
    )
  }

  if (rpcMethodSet.size !== rpcMethods.length) {
    throw new Error(`Launcher command owner "${manifest.id}" declares duplicate RPC methods`)
  }

  if (rpcMethods.length > 0 && !hasLauncherCommandOwnerCapability(manifest, "rpc")) {
    throw new Error(
      `Launcher command owner "${manifest.id}" declares RPC methods without the "rpc" capability`
    )
  }

  if (hasLauncherCommandOwnerCapability(manifest, "rpc") && rpcMethods.length === 0) {
    throw new Error(
      `Launcher command owner "${manifest.id}" declares the "rpc" capability without any RPC methods`
    )
  }

  if (manifest.clipboard && !hasLauncherCommandOwnerCapability(manifest, "clipboard")) {
    throw new Error(
      `Launcher command owner "${manifest.id}" declares clipboard filters without the "clipboard" capability`
    )
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message)
  }
}

function assertNonEmptyLocalizedText(
  value: unknown,
  message: string
): asserts value is LocalizedTextValue {
  if (typeof value === "string") {
    assertNonEmptyString(value, message)
    return
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message)
  }

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.en_US !== "string" ||
    typeof candidate.zh_Hans !== "string" ||
    candidate.en_US.trim().length === 0 ||
    candidate.zh_Hans.trim().length === 0
  ) {
    throw new Error(message)
  }
}
