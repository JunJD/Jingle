export const LAUNCHER_COMMAND_IDS = {
  actionPanelClose: "launcher.action-panel.close",
  actionPanelExecuteSelection: "launcher.action-panel.execute-selection",
  actionPanelMoveSelectionDown: "launcher.action-panel.move-selection-down",
  actionPanelMoveSelectionUp: "launcher.action-panel.move-selection-up",
  actionsExecutePrimary: "launcher.actions.execute-primary",
  actionsOpen: "launcher.actions.open",
  aiGoHome: "launcher.ai.go-home",
  aiSubmit: "launcher.ai.submit",
  close: "launcher.close",
  listMoveSelectionDown: "launcher.list.move-selection-down",
  listMoveSelectionUp: "launcher.list.move-selection-up",
  searchExecuteSelection: "launcher.search.execute-selection",
  searchMoveSelectionDown: "launcher.search.move-selection-down",
  searchMoveSelectionUp: "launcher.search.move-selection-up",
  searchOpenAi: "launcher.search.open-ai",
  toggle: "launcher.toggle"
} as const

export type LauncherCommandId = (typeof LAUNCHER_COMMAND_IDS)[keyof typeof LAUNCHER_COMMAND_IDS]
