import type {
  NativeExtensionInvokeContext,
  NativeExtensionService
} from "./shared/native-extensions"

type ExtensionMethodHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: NativeExtensionInvokeContext
) => Promise<TResult> | TResult

type UnknownExtensionMethodHandler = ExtensionMethodHandler<unknown, unknown>

type ExtensionMethodMap = Record<string, ExtensionMethodHandler<never, unknown>>

export function defineNativeExtensionService<TMethods extends ExtensionMethodMap>(
  extensionName: string,
  methods: TMethods
): NativeExtensionService {
  const methodNames = Object.keys(methods)

  return {
    extensionName,
    methods: methodNames,
    invoke: async (request, context) => {
      const method = methods[request.method] as UnknownExtensionMethodHandler | undefined
      if (!method) {
        throw new Error(
          `Native extension "${extensionName}" does not implement RPC method "${request.method}"`
        )
      }

      return method(request.payload, context)
    }
  }
}
