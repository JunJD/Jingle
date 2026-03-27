import type { ComponentType } from "react"
import type { AppLocale } from "../../../../shared/i18n"
import {
  getLauncherViewportHeightForBody,
  type LauncherShellConfig
} from "../../../../shared/launcher"
import type { BuiltPluginInvokeRequest } from "../../../../shared/built-plugins/sdk"
import type { AppCopy } from "@/lib/i18n/messages"
import { useLauncherPluginHost, useLauncherPluginLifecycle } from "../LauncherPluginHost"
import type {
  LauncherResultPresentation,
  LauncherResultPresentationIcon,
  LauncherResultPresentationTone
} from "../result-types"
import type {
  LauncherHomeEntry,
  LauncherPluginCommandMatch,
  LauncherPluginCommandParams,
  LauncherPluginDefinition,
  LauncherPluginEntryDefinition,
  LauncherPluginEntryId,
  LauncherPluginId,
  LauncherPluginManifest,
  LauncherPluginIntent
} from "../pages/types"

export interface BuiltLauncherPluginTextContext {
  copy: AppCopy
  locale: AppLocale
}

export interface BuiltLauncherPluginSpec {
  entries: BuiltLauncherPluginEntrySpec[]
  manifest: LauncherPluginManifest
}

export interface BuiltLauncherPluginEntrySpec {
  Component: ComponentType
  entryId: LauncherPluginEntryId
  home?: (
    context: BuiltLauncherPluginTextContext
  ) => Omit<LauncherHomeEntry, "entryId" | "pluginId">
  search?: {
    buildIntentItems?: (context: {
      copy: AppCopy
      locale: AppLocale
      query: string
    }) => LauncherPluginIntent[]
    resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
  }
  viewport:
    | {
        bodyHeight: number
      }
    | {
        getHeight: (shellConfig: LauncherShellConfig) => number
      }
}

export interface BuiltPluginClientMethod<TPayload, TResult> {
  payload?: TPayload
  result?: TResult
}

export interface BuiltLauncherIntentPresentationInput {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel?: string
  primaryActionLabel: string
  tone?: LauncherResultPresentationTone
}

type BuiltPluginClient<TMethods extends Record<string, BuiltPluginClientMethod<unknown, unknown>>> =
  {
    [TMethod in keyof TMethods]: (
      payload: NonNullable<TMethods[TMethod]["payload"]>
    ) => Promise<NonNullable<TMethods[TMethod]["result"]>>
  }

function getBuiltPluginViewportHeight(
  viewport: BuiltLauncherPluginEntrySpec["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if ("getHeight" in viewport) {
    return viewport.getHeight
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

function resolveBuiltPluginEntryDefinition(
  entry: BuiltLauncherPluginEntrySpec
): LauncherPluginEntryDefinition {
  return {
    Component: entry.Component,
    buildHomeEntry: entry.home,
    buildIntentItems: entry.search?.buildIntentItems,
    entryId: entry.entryId,
    getViewportHeight: getBuiltPluginViewportHeight(entry.viewport),
    resolveCommand: entry.search?.resolveCommand
  }
}

function validateBuiltLauncherPluginSpec(spec: BuiltLauncherPluginSpec): void {
  const manifestEntryIds = new Set(spec.manifest.entries.map((entry) => entry.id))
  const rendererEntryIds = new Set<string>()

  if (!manifestEntryIds.has(spec.manifest.defaultEntryId)) {
    throw new Error(
      `Launcher plugin "${spec.manifest.id}" default entry "${spec.manifest.defaultEntryId}" is not declared in its manifest`
    )
  }

  for (const entry of spec.entries) {
    if (rendererEntryIds.has(entry.entryId)) {
      throw new Error(
        `Launcher plugin "${spec.manifest.id}" declares duplicate renderer entry "${entry.entryId}"`
      )
    }

    if (!manifestEntryIds.has(entry.entryId)) {
      throw new Error(
        `Launcher plugin "${spec.manifest.id}" renderer entry "${entry.entryId}" is missing from its manifest`
      )
    }

    rendererEntryIds.add(entry.entryId)
  }

  if (rendererEntryIds.size !== manifestEntryIds.size) {
    throw new Error(
      `Launcher plugin "${spec.manifest.id}" manifest and renderer entries are out of sync`
    )
  }
}

export function defineBuiltLauncherPlugin(spec: BuiltLauncherPluginSpec): LauncherPluginDefinition {
  validateBuiltLauncherPluginSpec(spec)

  return {
    entries: spec.entries.map((entry) => resolveBuiltPluginEntryDefinition(entry)),
    manifest: spec.manifest
  }
}

export function defineBuiltPluginClientMethod<TPayload, TResult>(): BuiltPluginClientMethod<
  TPayload,
  TResult
> {
  return {}
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

export function createBuiltPluginClient<
  TMethods extends Record<string, BuiltPluginClientMethod<unknown, unknown>>
>(pluginId: LauncherPluginId, methods: TMethods): BuiltPluginClient<TMethods> {
  const clientEntries = Object.keys(methods).map((methodName) => [
    methodName,
    (payload: unknown) =>
      window.api.builtPlugins.invoke({
        method: methodName,
        payload,
        pluginId
      } satisfies BuiltPluginInvokeRequest)
  ])

  return Object.fromEntries(clientEntries) as BuiltPluginClient<TMethods>
}

export function useBuiltLauncherPluginHost() {
  return useLauncherPluginHost()
}

export const useBuiltLauncherPluginLifecycle = useLauncherPluginLifecycle

export type { LauncherResultPresentationIcon, LauncherResultPresentationTone }
