export const IPC_NETWORK_PRELOAD_CAPABILITY_ARGUMENT = "--jingle-preload-capability=ipc-network"

export function hasIpcNetworkPreloadCapability(argv: readonly string[]): boolean {
  return argv.includes(IPC_NETWORK_PRELOAD_CAPABILITY_ARGUMENT)
}
