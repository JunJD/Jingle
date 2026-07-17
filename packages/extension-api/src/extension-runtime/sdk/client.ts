import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"

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

  const declaredMethodNames = new Set(declaredMethods)
  for (const methodName of clientMethodNames) {
    if (!declaredMethodNames.has(methodName)) {
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
          throwExtensionRuntimeRequestError(response.error)
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
