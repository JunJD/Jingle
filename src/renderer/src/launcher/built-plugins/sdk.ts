import type { ComponentType } from "react"
import type { AppLocale } from "@shared/i18n"
import type { LauncherShellConfig } from "@shared/launcher"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import type { AppCopy } from "@/lib/i18n/messages"
import {
  useBuiltInLauncherClipboard,
  useBuiltInLauncherHost,
  useBuiltInLauncherLifecycle,
  useBuiltInLauncherNavigation,
  useBuiltInLauncherSurface,
  useBuiltInLauncherThreads
} from "../built-ins/host"
import {
  getLauncherViewportHeightForBody
} from "@shared/launcher"
import type {
  LauncherCommandDefinition,
  LauncherCommandIntent,
  LauncherCommandMatch,
  LauncherCommandName,
  LauncherCommandOwnerDefinition,
  LauncherCommandOwnerManifest,
  LauncherCommandParams,
  LauncherNoViewCommandRunContext
} from "../pages/types"
import type {
  LauncherResultPresentation,
  LauncherResultPresentationIcon,
  LauncherResultPresentationTone
} from "../result-types"

export interface BuiltInCommandOwnerSpec {
  commands: BuiltInCommandSpec[]
  manifest: LauncherCommandOwnerManifest
}

interface BuiltInCommandSearchSpec {
  commandName: LauncherCommandName
  search?: {
    buildIntentItems?: (context: {
      copy: AppCopy
      locale: AppLocale
      query: string
    }) => LauncherCommandIntent[]
    resolveCommand?: (params: LauncherCommandParams) => LauncherCommandMatch | null
  }
}

export interface BuiltInViewCommandSpec extends BuiltInCommandSearchSpec {
  Component: ComponentType
  mode: "view"
  viewport:
    | {
        bodyHeight: number
      }
    | {
        getHeight: (shellConfig: LauncherShellConfig) => number
      }
}

export interface BuiltInNoViewCommandSpec extends BuiltInCommandSearchSpec {
  mode: "no-view"
  run: (context: LauncherNoViewCommandRunContext) => Promise<void> | void
}

export type BuiltInCommandSpec = BuiltInViewCommandSpec | BuiltInNoViewCommandSpec

export interface BuiltInIntentPresentationInput {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel?: string
  primaryActionLabel: string
  tone?: LauncherResultPresentationTone
}

function getBuiltInViewportHeight(
  viewport: BuiltInViewCommandSpec["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if ("getHeight" in viewport) {
    return viewport.getHeight
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

function resolveBuiltInCommandDefinition(command: BuiltInCommandSpec): LauncherCommandDefinition {
  const baseDefinition = {
    buildIntentItems: command.search?.buildIntentItems,
    commandName: command.commandName,
    resolveCommand: command.search?.resolveCommand
  }

  if (command.mode === "view") {
    return {
      ...baseDefinition,
      Component: command.Component,
      getViewportHeight: getBuiltInViewportHeight(command.viewport),
      mode: command.mode
    }
  }

  return {
    ...baseDefinition,
    mode: command.mode,
    run: command.run
  }
}

function validateBuiltInCommandOwnerSpec(spec: BuiltInCommandOwnerSpec): void {
  validateLauncherCommandOwnerManifest(spec.manifest)
  const manifestCommandMap = new Map(
    spec.manifest.commands.map((command) => [command.name, command] as const)
  )
  const rendererCommandNames = new Set<string>()

  for (const command of spec.commands) {
    if (rendererCommandNames.has(command.commandName)) {
      throw new Error(
        `Built-in command owner "${spec.manifest.id}" declares duplicate renderer command "${command.commandName}"`
      )
    }

    const manifestCommand = manifestCommandMap.get(command.commandName)

    if (!manifestCommand) {
      throw new Error(
        `Built-in command owner "${spec.manifest.id}" renderer command "${command.commandName}" is missing from its manifest`
      )
    }

    if (manifestCommand.mode !== command.mode) {
      throw new Error(
        `Built-in command owner "${spec.manifest.id}" command "${command.commandName}" mode "${command.mode}" does not match manifest mode "${manifestCommand.mode}"`
      )
    }

    rendererCommandNames.add(command.commandName)
  }

  if (rendererCommandNames.size !== manifestCommandMap.size) {
    throw new Error(
      `Built-in command owner "${spec.manifest.id}" manifest and renderer commands are out of sync`
    )
  }
}

export function defineBuiltInCommandOwner(
  spec: BuiltInCommandOwnerSpec
): LauncherCommandOwnerDefinition {
  validateBuiltInCommandOwnerSpec(spec)

  return {
    commands: spec.commands.map((command) => resolveBuiltInCommandDefinition(command)),
    manifest: spec.manifest
  }
}

export function createBuiltInIntentPresentation(
  input: BuiltInIntentPresentationInput
): LauncherResultPresentation {
  return {
    categoryLabel: input.categoryLabel,
    icon: input.icon,
    listActionLabel: input.listActionLabel ?? input.primaryActionLabel,
    primaryActionLabel: input.primaryActionLabel,
    tone: input.tone ?? "accent"
  }
}

export function useBuiltInHost() {
  return useBuiltInLauncherHost()
}

export const useBuiltInLifecycle = useBuiltInLauncherLifecycle
export const useBuiltInClipboard = useBuiltInLauncherClipboard
export const useBuiltInNavigation = useBuiltInLauncherNavigation
export const useBuiltInSurface = useBuiltInLauncherSurface
export const useBuiltInThreads = useBuiltInLauncherThreads

export type { LauncherResultPresentationIcon, LauncherResultPresentationTone }
