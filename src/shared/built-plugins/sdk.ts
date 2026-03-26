export interface BuiltPluginInvokeRequest<TPayload = unknown> {
  method: string
  payload: TPayload
  pluginId: string
}
