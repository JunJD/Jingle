import type { LauncherCommandOwnerCapability } from "./launcher-command-owner"

export interface NativeExtensionCapabilityHost {
  capabilities: readonly LauncherCommandOwnerCapability[]
  extensionName: string
}

export function resolveNativeExtensionCapability<TValue>(
  host: NativeExtensionCapabilityHost,
  capability: LauncherCommandOwnerCapability,
  value: TValue | undefined
): TValue {
  const declaresCapability = host.capabilities.includes(capability)

  if (value !== undefined) {
    if (!declaresCapability) {
      throw new Error(
        `Native extension "${host.extensionName}" host exposed the "${capability}" capability without a manifest declaration`
      )
    }

    return value
  }

  if (!declaresCapability) {
    throw new Error(
      `Native extension "${host.extensionName}" tried to use the "${capability}" capability without declaring it`
    )
  }

  throw new Error(
    `Native extension "${host.extensionName}" declares the "${capability}" capability but the host did not provide it`
  )
}

export interface NativeExtensionNavigationHost<
  TOpenCommand extends (...args: any[]) => void = (...args: any[]) => void
> {
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: TOpenCommand
}

export interface NativeExtensionNavigationStack<TView = unknown> {
  canPop: boolean
  pop: () => void
  push: (view: TView) => void
}

export interface NativeExtensionNavigationBridge<
  TView = unknown,
  TOpenCommand extends (...args: any[]) => void = (...args: any[]) => void
> extends NativeExtensionNavigationHost<TOpenCommand> {
  canPop: boolean
  pop: () => void
  push: (view: TView) => void
}

export function createNativeExtensionNavigationBridge<
  TView = unknown,
  TOpenCommand extends (...args: any[]) => void = (...args: any[]) => void
>(input: {
  commandName: string
  extensionName: string
  navigation: NativeExtensionNavigationHost<TOpenCommand>
  stack: NativeExtensionNavigationStack<TView> | null
}): NativeExtensionNavigationBridge<TView, TOpenCommand> {
  const { commandName, extensionName, navigation, stack } = input

  const requireStack = (): NativeExtensionNavigationStack<TView> => {
    if (!stack) {
      throw new Error(
        `Native extension "${extensionName}" command "${commandName}" cannot use navigation stack actions outside a view command`
      )
    }

    return stack
  }

  return {
    canPop: stack?.canPop ?? false,
    goHome: navigation.goHome,
    hideLauncher: navigation.hideLauncher,
    openCommand: navigation.openCommand,
    pop: () => requireStack().pop(),
    push: (view) => requireStack().push(view)
  }
}
