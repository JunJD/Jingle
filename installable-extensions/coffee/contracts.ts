export const COFFEE_EXTENSION_ID = "coffee" as const
export const COFFEE_SOURCE_ID = "coffee" as const

export const COFFEE_RPC_METHOD_GET_STATUS = "get-status" as const
export const COFFEE_RPC_METHOD_START = "start" as const
export const COFFEE_RPC_METHOD_STOP = "stop" as const
export const COFFEE_RPC_METHOD_TOGGLE = "toggle" as const

export const COFFEE_RPC_METHODS = [
  COFFEE_RPC_METHOD_GET_STATUS,
  COFFEE_RPC_METHOD_START,
  COFFEE_RPC_METHOD_STOP,
  COFFEE_RPC_METHOD_TOGGLE
] as const

export type CoffeeIconSet = "cup" | "mug" | "paper-cup" | "pot"

export interface CoffeePreferences {
  icon?: CoffeeIconSet
  preventDisk?: boolean
  preventDisplay?: boolean
  preventSystem?: boolean
}

export interface CoffeeStatus {
  isRunning: boolean
  secondsRemaining: number | null
  timeRemaining: string | null
}

export interface CoffeeStartRequest {
  durationSeconds?: number
}
