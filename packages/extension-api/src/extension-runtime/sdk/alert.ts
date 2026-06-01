import { getActiveExtensionRuntimeSdk } from "./context"
import type {
  ExtensionAlertActionPayload,
  ExtensionConfirmAlertPayload
} from "../../shared/extension-runtime-protocol"
import type { IconLike } from "./visual"

export type RuntimeAlertActionStyle = "cancel" | "default" | "destructive"

export interface RuntimeAlertAction {
  style?: RuntimeAlertActionStyle
  title: string
}

export interface RuntimeConfirmAlertOptions {
  dismissAction?: RuntimeAlertAction
  icon?: IconLike
  message?: string
  primaryAction?: RuntimeAlertAction
  title: string
}

export const Alert = {
  ActionStyle: {
    Cancel: "cancel",
    Default: "default",
    Destructive: "destructive"
  } satisfies Record<string, RuntimeAlertActionStyle>
}

export async function confirmAlert(options: RuntimeConfirmAlertOptions): Promise<boolean> {
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "dialog",
    method: "confirm-alert",
    payload: toConfirmAlertPayload(options)
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }

  return response.result === true
}

function toConfirmAlertPayload(options: RuntimeConfirmAlertOptions): ExtensionConfirmAlertPayload {
  return {
    dismissAction: toAlertActionPayload(options.dismissAction),
    message: options.message,
    primaryAction: toAlertActionPayload(options.primaryAction),
    title: options.title
  }
}

function toAlertActionPayload(
  action: RuntimeAlertAction | undefined
): ExtensionAlertActionPayload | undefined {
  return action ? { style: action.style, title: action.title } : undefined
}
