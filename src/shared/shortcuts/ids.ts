export const LAUNCHER_COMMAND_IDS = {
  actionPanelClose: "launcher.action-panel.close",
  actionPanelExecuteSelection: "launcher.action-panel.execute-selection",
  actionPanelMoveSelectionDown: "launcher.action-panel.move-selection-down",
  actionPanelMoveSelectionUp: "launcher.action-panel.move-selection-up",
  actionsExecutePrimary: "launcher.actions.execute-primary",
  actionsOpen: "launcher.actions.open",
  aiAddAttachment: "launcher.ai.add-attachment",
  aiBranchChat: "launcher.ai.branch-chat",
  aiChangeModel: "launcher.ai.change-model",
  aiGoHome: "launcher.ai.go-home",
  aiGoToNextChat: "launcher.ai.go-to-next-chat",
  aiGoToPreviousChat: "launcher.ai.go-to-previous-chat",
  aiNewQuestion: "launcher.ai.new-question",
  aiSubmit: "launcher.ai.submit",
  close: "launcher.close",
  listMoveSelectionDown: "launcher.list.move-selection-down",
  listMoveSelectionUp: "launcher.list.move-selection-up",
  searchExecuteSelection: "launcher.search.execute-selection",
  searchMoveSelectionDown: "launcher.search.move-selection-down",
  searchOpenSettings: "launcher.search.open-settings",
  searchMoveSelectionUp: "launcher.search.move-selection-up",
  searchOpenAi: "launcher.search.open-ai",
  toggle: "launcher.toggle"
} as const

export type LauncherCommandId = (typeof LAUNCHER_COMMAND_IDS)[keyof typeof LAUNCHER_COMMAND_IDS]
