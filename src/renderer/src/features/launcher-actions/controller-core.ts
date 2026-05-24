export function resolveActionPanelShortcutOpenState(
  currentOpen: boolean,
  canOpenActions: boolean
): boolean {
  if (!canOpenActions) {
    return false
  }

  return !currentOpen
}
