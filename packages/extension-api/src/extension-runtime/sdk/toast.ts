import { getActiveExtensionRuntimeSdk, type ExtensionRuntimeSdkContextValue } from "./runtime-context"
import type { RuntimeKeyboardShortcut } from "./keyboard"
import type {
  ExtensionActionShortcutNode,
  ExtensionToastActionPayload,
  ExtensionToastPayload,
  ExtensionToastStyle
} from "../../shared/extension-runtime-protocol"

export type RuntimeToastStyle = ExtensionToastStyle

export interface RuntimeToastAction {
  onAction?: () => Promise<void> | void
  shortcut?: RuntimeKeyboardShortcut
  title: string
}

export interface RuntimeToastOptions {
  message?: string
  primaryAction?: RuntimeToastAction
  secondaryAction?: RuntimeToastAction
  style?: RuntimeToastStyle
  title: string
}

export const Toast = {
  Style: {
    Animated: "animated",
    Failure: "failure",
    Success: "success"
  } satisfies Record<string, RuntimeToastStyle>
}

export async function showToast(options: RuntimeToastOptions): Promise<void> {
  const context = getActiveExtensionRuntimeSdk()
  const response = await context.requestHost({
    capability: "toast",
    method: "show",
    payload: toToastPayload(context, options)
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

export async function showHUD(title: string): Promise<void> {
  await showToast({
    style: Toast.Style.Success,
    title
  })
}

function toToastPayload(
  context: ExtensionRuntimeSdkContextValue,
  options: RuntimeToastOptions
): ExtensionToastPayload {
  return {
    message: options.message,
    primaryAction: toToastActionPayload(context, options.primaryAction),
    secondaryAction: toToastActionPayload(context, options.secondaryAction),
    style: options.style,
    title: options.title
  }
}

function toToastActionPayload(
  context: ExtensionRuntimeSdkContextValue,
  action: RuntimeToastAction | undefined
): ExtensionToastActionPayload | undefined {
  if (!action?.onAction || !context.registerToastAction) {
    return undefined
  }

  const registration = context.registerToastAction(action.onAction)
  return {
    id: registration.id,
    shortcut: toToastShortcutPayload(action.shortcut),
    title: action.title
  }
}

function toToastShortcutPayload(
  shortcut: RuntimeKeyboardShortcut | undefined
): ExtensionActionShortcutNode | undefined {
  const platformShortcut = shortcut?.macOS ?? shortcut?.Windows
  if (!platformShortcut) {
    return undefined
  }

  return {
    key: platformShortcut.key,
    modifiers: platformShortcut.modifiers
  }
}
