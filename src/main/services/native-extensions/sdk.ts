import type {
  NativeExtensionService
} from "../../../shared/native-extensions"

type NativeExtensionMethodHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload
) => Promise<TResult> | TResult

type UnknownNativeExtensionMethodHandler = NativeExtensionMethodHandler<unknown, unknown>

type NativeExtensionMethodMap = Record<string, NativeExtensionMethodHandler<never, unknown>>

export function defineNativeExtensionService<TMethods extends NativeExtensionMethodMap>(
  extensionName: string,
  methods: TMethods
): NativeExtensionService {
  const methodNames = Object.keys(methods)

  return {
    extensionName,
    methods: methodNames,
    invoke: async (request) => {
      const method = methods[request.method] as UnknownNativeExtensionMethodHandler | undefined
      if (!method) {
        throw new Error(
          `Native extension "${extensionName}" does not implement RPC method "${request.method}"`
        )
      }

      return method(request.payload)
    }
  }
}
