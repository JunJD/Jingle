import { getActiveExtensionRuntimeSdk } from "./context"

export interface RuntimeNativeExtensionClientMethod<TPayload, TResult> {
  payload?: TPayload
  result?: TResult
}

type RuntimeNativeExtensionClient<
  TMethods extends Record<string, RuntimeNativeExtensionClientMethod<unknown, unknown>>
> = {
  [TMethod in keyof TMethods]: (
    payload: NonNullable<TMethods[TMethod]["payload"]>
  ) => Promise<NonNullable<TMethods[TMethod]["result"]>>
}

export function createNativeExtensionClient<
  TMethods extends Record<string, RuntimeNativeExtensionClientMethod<unknown, unknown>>
>(extensionName: string, declaredMethods: readonly string[], methods: TMethods) {
  const clientMethodNames = Object.keys(methods)

  if (declaredMethods.length !== clientMethodNames.length) {
    throw new Error(
      `Native extension client "${extensionName}" method count does not match its manifest RPC declaration`
    )
  }

  for (const methodName of clientMethodNames) {
    if (!declaredMethods.includes(methodName)) {
      throw new Error(
        `Native extension client "${extensionName}" implements "${methodName}" but it is not declared in the manifest`
      )
    }
  }

  return Object.fromEntries(
    clientMethodNames.map((methodName) => [
      methodName,
      async (payload: unknown) => {
        const response = await getActiveExtensionRuntimeSdk().requestHost({
          capability: "rpc",
          method: "invoke-native-extension",
          payload: {
            extensionName,
            method: methodName,
            payload
          }
        })

        if (!response.ok) {
          throw new Error(response.error.message)
        }

        return response.result
      }
    ])
  ) as RuntimeNativeExtensionClient<TMethods>
}

export function defineNativeExtensionClientMethod<
  TPayload,
  TResult
>(): RuntimeNativeExtensionClientMethod<TPayload, TResult> {
  return {}
}

export const createExtensionClient = createNativeExtensionClient
export const defineExtensionClientMethod = defineNativeExtensionClientMethod
