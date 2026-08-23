export function supportsPosixFileModes(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32"
}
