import { getActiveExtensionRuntimeSdk } from "./context"
import type { RuntimeKeyboardShortcut } from "./keyboard"
import type {
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
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "toast",
    method: "show",
    payload: toToastPayload(options)
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

function toToastPayload(options: RuntimeToastOptions): ExtensionToastPayload {
  return {
    message: options.message,
    primaryAction: toToastActionPayload(options.primaryAction),
    secondaryAction: toToastActionPayload(options.secondaryAction),
    style: options.style,
    title: options.title
  }
}

function toToastActionPayload(
  action: RuntimeToastAction | undefined
): ExtensionToastActionPayload | undefined {
  return action ? { title: action.title } : undefined
}
