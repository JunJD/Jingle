export const launcherShellCommands = {
  hide(): Promise<void> {
    return window.api.launcher.hide()
  },

  openExtensionSettings(extensionName: string, commandName: string): Promise<void> {
    return window.api.settings.openWindow({
      tab: "extensions",
      target: {
        commandName,
        extensionName
      }
    })
  }
}
