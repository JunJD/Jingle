import type { ComponentType } from "react"
import type { AppLocale } from "../../../../shared/i18n"
import {
  getLauncherViewportHeightForBody,
  type LauncherShellConfig
} from "../../../../shared/launcher"
import type { AppCopy } from "@/lib/i18n/messages"
import {
  useLauncherPluginClipboard,
  useLauncherPluginHost,
  useLauncherPluginLifecycle,
  useLauncherPluginNavigation,
  useLauncherPluginSurface,
  useLauncherPluginThreads
} from "../LauncherPluginHost"
import type {
  LauncherResultPresentation,
  LauncherResultPresentationIcon,
  LauncherResultPresentationTone
} from "../result-types"
import type {
  LauncherNoViewPluginRunContext,
  LauncherPluginCommandMatch,
  LauncherPluginCommandParams,
  LauncherPluginCommandDefinition,
  LauncherPluginCommandName,
  LauncherPluginDefinition,
  LauncherPluginManifest,
  LauncherPluginIntent
} from "../pages/types"
import { validateLauncherPluginManifest } from "../../../../shared/launcher-plugin"

export interface BuiltLauncherPluginSpec {
  commands: BuiltLauncherPluginCommandSpec[]
  manifest: LauncherPluginManifest
}

interface BuiltLauncherPluginSearchSpec {
  commandName: LauncherPluginCommandName
  search?: {
    buildIntentItems?: (context: {
      copy: AppCopy
      locale: AppLocale
      query: string
    }) => LauncherPluginIntent[]
    resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
  }
}

export interface BuiltLauncherViewPluginCommandSpec extends BuiltLauncherPluginSearchSpec {
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

export interface BuiltLauncherNoViewPluginCommandSpec extends BuiltLauncherPluginSearchSpec {
  mode: "no-view"
  run: (context: LauncherNoViewPluginRunContext) => Promise<void> | void
}

export type BuiltLauncherPluginCommandSpec =
  | BuiltLauncherViewPluginCommandSpec
  | BuiltLauncherNoViewPluginCommandSpec

export interface BuiltLauncherIntentPresentationInput {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel?: string
  primaryActionLabel: string
  tone?: LauncherResultPresentationTone
}

function getBuiltPluginViewportHeight(
  viewport: BuiltLauncherViewPluginCommandSpec["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if ("getHeight" in viewport) {
    return viewport.getHeight
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

function resolveBuiltPluginCommandDefinition(
  command: BuiltLauncherPluginCommandSpec
): LauncherPluginCommandDefinition {
  const baseDefinition = {
    buildIntentItems: command.search?.buildIntentItems,
    commandName: command.commandName,
    resolveCommand: command.search?.resolveCommand
  }

  if (command.mode === "view") {
    return {
      ...baseDefinition,
      Component: command.Component,
      getViewportHeight: getBuiltPluginViewportHeight(command.viewport),
      mode: command.mode
    }
  }

  return {
    ...baseDefinition,
    mode: command.mode,
    run: command.run
  }
}

function validateBuiltLauncherPluginSpec(spec: BuiltLauncherPluginSpec): void {
  validateLauncherPluginManifest(spec.manifest)
  const manifestCommandMap = new Map(
    spec.manifest.commands.map((command) => [command.name, command] as const)
  )
  const rendererCommandNames = new Set<string>()

  for (const command of spec.commands) {
    if (rendererCommandNames.has(command.commandName)) {
      throw new Error(
        `Launcher plugin "${spec.manifest.id}" declares duplicate renderer command "${command.commandName}"`
      )
    }

    const manifestCommand = manifestCommandMap.get(command.commandName)

    if (!manifestCommand) {
      throw new Error(
        `Launcher plugin "${spec.manifest.id}" renderer command "${command.commandName}" is missing from its manifest`
      )
    }

    if (manifestCommand.mode !== command.mode) {
      throw new Error(
        `Launcher plugin "${spec.manifest.id}" command "${command.commandName}" mode "${command.mode}" does not match manifest mode "${manifestCommand.mode}"`
      )
    }

    rendererCommandNames.add(command.commandName)
  }

  if (rendererCommandNames.size !== manifestCommandMap.size) {
    throw new Error(
      `Launcher plugin "${spec.manifest.id}" manifest and renderer commands are out of sync`
    )
  }
}

export function defineBuiltLauncherPlugin(spec: BuiltLauncherPluginSpec): LauncherPluginDefinition {
  validateBuiltLauncherPluginSpec(spec)

  return {
    commands: spec.commands.map((command) => resolveBuiltPluginCommandDefinition(command)),
    manifest: spec.manifest
  }
}

export function createBuiltLauncherIntentPresentation(
  input: BuiltLauncherIntentPresentationInput
): LauncherResultPresentation {
  return {
    categoryLabel: input.categoryLabel,
    icon: input.icon,
    listActionLabel: input.listActionLabel ?? input.primaryActionLabel,
    primaryActionLabel: input.primaryActionLabel,
    tone: input.tone ?? "accent"
  }
}

export function useBuiltLauncherPluginHost() {
  return useLauncherPluginHost()
}

export const useBuiltLauncherPluginLifecycle = useLauncherPluginLifecycle
export const useBuiltLauncherPluginClipboard = useLauncherPluginClipboard
export const useBuiltLauncherPluginNavigation = useLauncherPluginNavigation
export const useBuiltLauncherPluginSurface = useLauncherPluginSurface
export const useBuiltLauncherPluginThreads = useLauncherPluginThreads

export type { LauncherResultPresentationIcon, LauncherResultPresentationTone }
