export type DevtoolsNetworkDirection = "internal" | "main-to-renderer" | "renderer-to-main"

export type DevtoolsNetworkPattern = "invoke" | "record" | "send"

export type DevtoolsNetworkStatus = "error" | "pending" | "sent" | "success"

export type DevtoolsNetworkSource = "agent-stream" | "agent-trace" | "ipc"

export const DEVTOOLS_NETWORK_WINDOW_KIND = "ipc-network"
export type DevtoolsNetworkWindowKind = typeof DEVTOOLS_NETWORK_WINDOW_KIND

export interface DevtoolsNetworkValueSummary {
  readonly preview: unknown
  readonly truncated: boolean
}

export interface DevtoolsNetworkErrorSummary {
  readonly message: string
  readonly name: string
}

export interface DevtoolsNetworkEntry {
  readonly args?: readonly DevtoolsNetworkValueSummary[]
  readonly channel: string
  readonly completedAt?: string
  readonly direction: DevtoolsNetworkDirection
  readonly durationMs?: number
  readonly error?: DevtoolsNetworkErrorSummary
  readonly id: string
  readonly metadata?: DevtoolsNetworkValueSummary
  readonly pattern: DevtoolsNetworkPattern
  readonly payload?: DevtoolsNetworkValueSummary
  readonly result?: DevtoolsNetworkValueSummary
  readonly sequence: number
  readonly source: DevtoolsNetworkSource
  readonly startedAt: string
  readonly status: DevtoolsNetworkStatus
  readonly webContentsId?: number
}

export const IPC_NETWORK_LIST_CHANNEL = "devtools:ipcNetwork:list"
export const IPC_NETWORK_CLEAR_CHANNEL = "devtools:ipcNetwork:clear"
export const IPC_NETWORK_OPEN_WINDOW_CHANNEL = "devtools:ipcNetwork:openWindow"
export const IPC_NETWORK_INTERNAL_CHANNELS = [
  IPC_NETWORK_LIST_CHANNEL,
  IPC_NETWORK_CLEAR_CHANNEL,
  IPC_NETWORK_OPEN_WINDOW_CHANNEL
] as const

export type IpcNetworkInternalChannel = (typeof IPC_NETWORK_INTERNAL_CHANNELS)[number]

export const IPC_NETWORK_WINDOW_KIND = DEVTOOLS_NETWORK_WINDOW_KIND

export type IpcNetworkDirection = DevtoolsNetworkDirection
export type IpcNetworkPattern = DevtoolsNetworkPattern
export type IpcNetworkStatus = DevtoolsNetworkStatus
export type IpcNetworkSource = DevtoolsNetworkSource
export type IpcNetworkWindowKind = DevtoolsNetworkWindowKind
export type IpcNetworkValueSummary = DevtoolsNetworkValueSummary
export type IpcNetworkErrorSummary = DevtoolsNetworkErrorSummary
export type IpcNetworkEntry = DevtoolsNetworkEntry
