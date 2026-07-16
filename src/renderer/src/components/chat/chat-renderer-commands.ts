export const chatRendererCommands = {
  openExternal(url: string): Promise<void> {
    return window.electron.openExternal(url)
  }
}
