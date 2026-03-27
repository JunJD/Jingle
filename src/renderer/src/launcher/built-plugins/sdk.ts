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
  LauncherPluginId,
  LauncherPluginIntent
} from "../pages/types"

export interface BuiltLauncherPluginTextContext {
  copy: AppCopy
  locale: AppLocale
}

export interface BuiltLauncherPluginSpec {
  Component: ComponentType
  manifest: {
    home?: (context: BuiltLauncherPluginTextContext) => Omit<LauncherHomeEntry, "pluginId">
    id: LauncherPluginId
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
  viewport: BuiltLauncherPluginSpec["manifest"]["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if ("getHeight" in viewport) {
    return viewport.getHeight
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

export function defineBuiltLauncherPlugin(spec: BuiltLauncherPluginSpec): LauncherPluginDefinition {
  const viewportHeight = getBuiltPluginViewportHeight(spec.manifest.viewport)
  const buildHomeEntry = spec.manifest.home

  return {
    Component: spec.Component,
    buildHomeEntry: buildHomeEntry
      ? (context) => ({
          ...buildHomeEntry(context),
          pluginId: spec.manifest.id
        })
      : undefined,
    buildIntentItems: spec.manifest.search?.buildIntentItems,
    getViewportHeight: viewportHeight,
    id: spec.manifest.id,
    resolveCommand: spec.manifest.search?.resolveCommand
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
