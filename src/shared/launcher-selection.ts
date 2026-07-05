export interface LauncherSelectionAnchor {
  x: number
  y: number
}

export interface LauncherSelectionContext {
  anchor: LauncherSelectionAnchor
  capturedAt: string
  id: string
  sourceApplicationName?: string
  sourceBundleId?: string
  text: string
}

export type LauncherSelectionContextSnapshot = LauncherSelectionContext | null

export interface LauncherSelectionCapturePayload {
  anchor: LauncherSelectionAnchor
  sourceApplicationName?: string
  sourceBundleId?: string
  text: string
}

export interface LauncherSelectionContextInput extends LauncherSelectionCapturePayload {
  capturedAt: string
  id: string
}

export function createLauncherSelectionContext(
  payload: LauncherSelectionContextInput
): LauncherSelectionContext {
  return {
    anchor: payload.anchor,
    capturedAt: payload.capturedAt,
    id: payload.id,
    ...(payload.sourceApplicationName
      ? { sourceApplicationName: payload.sourceApplicationName }
      : {}),
    ...(payload.sourceBundleId ? { sourceBundleId: payload.sourceBundleId } : {}),
    text: payload.text
  }
}

export function buildLauncherSelectionPromptText(params: {
  selection: LauncherSelectionContext
  userText: string
}): string {
  const trimmedUserText = params.userText.trim()
  const sourceLabel = params.selection.sourceApplicationName
    ? ` from ${params.selection.sourceApplicationName}`
    : ""
  const selectedText = `Selected text${sourceLabel}:\n${params.selection.text}`

  if (!trimmedUserText) {
    return selectedText
  }

  return `${selectedText}\n\nUser request:\n${trimmedUserText}`
}
