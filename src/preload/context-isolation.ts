export function assertContextIsolation(enabled: boolean): asserts enabled {
  if (!enabled) {
    throw new Error("[Preload] Jingle requires Electron context isolation.")
  }
}
