export const LAUNCHER_COMMAND_IDS = {
  actionsExecutePrimary: "launcher.actions.execute-primary",
  actionsOpen: "launcher.actions.open",
  aiSubmit: "launcher.ai.submit",
  close: "launcher.close",
  searchExecuteSelection: "launcher.search.execute-selection",
  searchMoveSelectionDown: "launcher.search.move-selection-down",
  searchMoveSelectionUp: "launcher.search.move-selection-up",
  searchOpenAi: "launcher.search.open-ai",
  toggle: "launcher.toggle"
} as const

export type LauncherCommandId = (typeof LAUNCHER_COMMAND_IDS)[keyof typeof LAUNCHER_COMMAND_IDS]
