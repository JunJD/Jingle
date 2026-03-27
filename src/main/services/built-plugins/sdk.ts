import type { BuiltPluginInvokeRequest } from "../../../shared/built-plugins/sdk"

type BuiltPluginMethodHandler<TPayload = any, TResult = any> = (
  payload: TPayload
) => Promise<TResult> | TResult

type BuiltPluginMethodMap = Record<string, BuiltPluginMethodHandler>

export interface BuiltPluginService {
  invoke: (request: BuiltPluginInvokeRequest) => Promise<unknown>
  methods: string[]
  pluginId: string
}

export function defineBuiltPluginService<TMethods extends BuiltPluginMethodMap>(
  pluginId: string,
  methods: TMethods
): BuiltPluginService {
  const methodNames = Object.keys(methods)

  return {
    pluginId,
    methods: methodNames,
    invoke: async (request) => {
      const method = methods[request.method]
      if (!method) {
        throw new Error(`Built plugin "${pluginId}" does not implement "${request.method}"`)
      }

      return method(request.payload)
    }
  }
}
