import {
  createNativeExtensionClient,
  defineNativeExtensionClientMethod,
  useExtensionRuntimeSdk
} from "@jingle/extension-api"
import type { CoffeePreferences, CoffeeStartRequest, CoffeeStatus } from "../contracts"
import { COFFEE_EXTENSION_ID, COFFEE_RPC_METHODS } from "../contracts"

export const coffeeRuntimeClient = createNativeExtensionClient(
  COFFEE_EXTENSION_ID,
  COFFEE_RPC_METHODS,
  {
    "get-status": defineNativeExtensionClientMethod<Record<string, never>, CoffeeStatus>(),
    "start": defineNativeExtensionClientMethod<CoffeeStartRequest, CoffeeStatus>(),
    "stop": defineNativeExtensionClientMethod<Record<string, never>, CoffeeStatus>(),
    "toggle": defineNativeExtensionClientMethod<Record<string, never>, CoffeeStatus>()
  }
)

export function useCoffeePreferences(): CoffeePreferences {
  return useExtensionRuntimeSdk().extensionPreferences as CoffeePreferences
}

export function useCoffeeCommandPreferences<T extends object>(): T {
  return useExtensionRuntimeSdk().commandPreferences as T
}

export function getCoffeeStatus(): Promise<CoffeeStatus> {
  return coffeeRuntimeClient["get-status"]({})
}

export function startCoffee(payload: CoffeeStartRequest = {}): Promise<CoffeeStatus> {
  return coffeeRuntimeClient["start"](payload)
}

export function stopCoffee(): Promise<CoffeeStatus> {
  return coffeeRuntimeClient["stop"]({})
}

export function toggleCoffee(): Promise<CoffeeStatus> {
  return coffeeRuntimeClient["toggle"]({})
}
