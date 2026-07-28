import type {
  ComputerUseActionKind,
  ComputerUseBackendEnvironment,
  ComputerUseCapability,
  ComputerUseCapabilityMatrix,
  ComputerUsePlatform
} from "./src/contract"

export const JINGLE_COMPUTER_USE_PROTOCOL_VERSION: 1
export const COMPUTER_USE_NATIVE_ACTIONS: readonly ComputerUseActionKind[]

export interface ComputerUseNativeCapabilityPolicy {
  readonly background: readonly ComputerUseCapability["background"][]
  readonly foreground: readonly ComputerUseCapability["foreground"][]
  readonly route: string
}

export interface ComputerUseNativeEnvironmentPolicy {
  readonly capabilities: Readonly<Record<ComputerUseActionKind, ComputerUseNativeCapabilityPolicy>>
  readonly platform: ComputerUsePlatform
}

export function getComputerUseNativeEnvironmentPolicy(
  environment: ComputerUseBackendEnvironment
): ComputerUseNativeEnvironmentPolicy

export function createComputerUseNativeProbeRequest(
  environment: ComputerUseBackendEnvironment,
  requestPermission: boolean
): Readonly<{
  environment: ComputerUseBackendEnvironment
  method: "probe"
  protocolVersion: typeof JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  requestPermission: boolean
}>

export function validateComputerUseNativeCapabilityMatrix(
  environment: ComputerUseBackendEnvironment,
  value: unknown
): ComputerUseCapabilityMatrix
