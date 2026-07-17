import { isDeepStrictEqual } from "node:util"
import type { AppLocale } from "@shared/i18n"
import type {
  ExtensionRuntimeHostCapability,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeLaunchIntent,
  ExtensionRuntimeLaunchPackageRef,
  ExtensionRuntimeSessionKind,
  ExtensionRuntimeUtilityExecutionLease
} from "@shared/extension-runtime-protocol"
import { normalizeExtensionRuntimeLaunchIntent } from "@shared/extension-runtime-protocol"
import { getDefaultExtensionRegistryService } from "../../extensions/registry/default-registry"
import {
  getNativeExtensionConfigurationSnapshot,
  type NativeExtensionConfigurationToken
} from "../../preferences"
import {
  resolveNativeExtensionExecutionContextFromSnapshot,
  type NativeExtensionExecutionContextSnapshot
} from "../../native-extensions/execution-context"

export interface ExtensionRuntimeExecutionLease {
  configurationToken: NativeExtensionConfigurationToken
  intent: ExtensionRuntimeLaunchIntent
  invokeContext: NativeExtensionExecutionContextSnapshot
  runtimeCapabilities: readonly ExtensionRuntimeHostCapability[]
  utility: ExtensionRuntimeUtilityExecutionLease
}

export interface ExtensionRuntimeExecutionLeaseOwner {
  isCurrent: (lease: ExtensionRuntimeExecutionLease) => boolean
  resolve: (
    kind: ExtensionRuntimeSessionKind,
    intent: ExtensionRuntimeLaunchIntent
  ) => ExtensionRuntimeExecutionLease
}

export function createExtensionRuntimeExecutionLeaseOwner(options: {
  getLocale: () => AppLocale
}): ExtensionRuntimeExecutionLeaseOwner {
  return {
    isCurrent: isExtensionRuntimeExecutionLeaseCurrent,
    resolve: (kind, intent) => resolveExtensionRuntimeExecutionLease(kind, intent, options)
  }
}

export function isExtensionRuntimeExecutionLeaseCurrent(
  lease: ExtensionRuntimeExecutionLease
): boolean {
  try {
    const current = getNativeExtensionConfigurationSnapshot({
      commandName: lease.intent.commandName,
      extensionName: lease.intent.extensionName,
      platform: process.platform
    })
    return isDeepStrictEqual(current.token, lease.configurationToken)
  } catch {
    return false
  }
}

function resolveExtensionRuntimeExecutionLease(
  kind: ExtensionRuntimeSessionKind,
  rawIntent: ExtensionRuntimeLaunchIntent,
  options: { getLocale: () => AppLocale }
): ExtensionRuntimeExecutionLease {
  const intent = normalizeExtensionRuntimeLaunchIntent(rawIntent)
  const registry = getDefaultExtensionRegistryService()
  const extensionPackage = registry
    .listEnabledPackages(process.platform)
    .find((candidate) => candidate.id === intent.extensionName)
  if (!extensionPackage) {
    throw new Error(`Unknown native extension "${intent.extensionName}"`)
  }

  const command = extensionPackage.manifest.commands.find(
    (candidate) => candidate.name === intent.commandName
  )
  if (!command?.runtime) {
    throw new Error(
      `Native extension "${intent.extensionName}" does not declare runtime command "${intent.commandName}"`
    )
  }

  const expectedMode = getExpectedCommandMode(kind)
  if (command.mode !== expectedMode) {
    throw new Error(
      `Native extension runtime command "${intent.extensionName}:${intent.commandName}" cannot start as ${kind}; expected mode "${expectedMode}" but found "${command.mode}".`
    )
  }

  const runtime = toRuntimePackageRef(extensionPackage.runtime, intent.extensionName)
  const runtimeCapabilities = [...(extensionPackage.manifest.runtimeCapabilities ?? [])]
  const locale = options.getLocale()

  // The persisted configuration snapshot is the final fact read before the lease is assembled.
  const snapshot = getNativeExtensionConfigurationSnapshot({
    commandName: intent.commandName,
    extensionName: intent.extensionName,
    platform: process.platform
  })
  const invokeContext = resolveNativeExtensionExecutionContextFromSnapshot(snapshot)
  const utility = createExtensionRuntimeUtilityExecutionLease({
    intent,
    invokeContext,
    locale,
    mode: expectedMode,
    runtime,
    runtimeCapabilities
  })

  return deepFreeze({
    configurationToken: snapshot.token,
    intent,
    invokeContext,
    runtimeCapabilities,
    utility
  })
}

export function createExtensionRuntimeUtilityExecutionLease(input: {
  intent: ExtensionRuntimeLaunchIntent
  invokeContext: NativeExtensionExecutionContextSnapshot
  locale: AppLocale
  mode: ExtensionRuntimeLaunchContext["mode"]
  runtime: ExtensionRuntimeLaunchPackageRef
  runtimeCapabilities: readonly ExtensionRuntimeHostCapability[]
}): ExtensionRuntimeUtilityExecutionLease {
  const canReadPreferences = input.runtimeCapabilities.includes("preferences")
  const dataIdentity = createExtensionRuntimeDataIdentity(input.invokeContext)
  const context: ExtensionRuntimeLaunchContext = {
    commandName: input.intent.commandName,
    commandPreferences: canReadPreferences
      ? (input.invokeContext.commandPreferences ?? input.invokeContext.extensionPreferences)
      : {},
    dataIdentity,
    extensionName: input.intent.extensionName,
    extensionPreferences: canReadPreferences ? input.invokeContext.extensionPreferences : {},
    initialAction: input.intent.initialAction,
    ...(input.intent.launchProps ? { launchProps: input.intent.launchProps } : {}),
    locale: input.locale,
    mode: input.mode,
    seedQuery: input.intent.seedQuery
  }

  return deepFreeze({
    context,
    runtime: input.runtime
  })
}

function createExtensionRuntimeDataIdentity(
  context: NativeExtensionExecutionContextSnapshot
): ExtensionRuntimeLaunchContext["dataIdentity"] {
  const revisions = context.configurationToken.revisions
  const localStorage = {
    connectionId: context.configurationToken.connectionId,
    credentialGeneration: revisions.credentialRevision
  }

  return {
    kind: "available",
    cache: {
      kind: "unavailable",
      reason: "artifact-revision-unavailable"
    },
    localStorage
  }
}

function getExpectedCommandMode(
  kind: ExtensionRuntimeSessionKind
): ExtensionRuntimeLaunchContext["mode"] {
  switch (kind) {
    case "ambient":
      return "menu-bar"
    case "foreground":
      return "view"
    case "run-once":
      return "no-view"
  }
}

function toRuntimePackageRef(
  runtime: ReturnType<
    ReturnType<typeof getDefaultExtensionRegistryService>["getRuntimePackageRef"]
  >,
  extensionName: string
): ExtensionRuntimeLaunchPackageRef {
  if (!runtime) {
    throw new Error(`Native extension "${extensionName}" has no runtime package`)
  }
  if (runtime.extensionName !== extensionName) {
    throw new Error(
      `Native extension runtime package "${runtime.extensionName}" does not match "${extensionName}"`
    )
  }

  return runtime.kind === "module"
    ? {
        extensionName: runtime.extensionName,
        kind: "module",
        modulePath: runtime.modulePath,
        version: runtime.version
      }
    : {
        extensionName: runtime.extensionName,
        kind: "built-in",
        version: runtime.version
      }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value
  }

  seen.add(value)
  for (const child of Object.values(value)) {
    deepFreeze(child, seen)
  }
  return Object.freeze(value)
}
