import {
  contentAnnotationChangedEventSchema,
  contentAnnotationListSchema,
  contentAnnotationSchema,
  type ContentAnnotationChangedEvent,
  type CreateContentAnnotationInput,
  type DeleteContentAnnotationInput,
  type UpdateContentAnnotationInput
} from "@shared/content-annotation"
import { invokeIpc, ipcRenderer } from "../ipc"

export const contentAnnotationsApi = {
  onChanged: (listener: (event: ContentAnnotationChangedEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => {
      const parsed = contentAnnotationChangedEventSchema.safeParse(payload)
      if (!parsed.success) {
        console.error("[ContentAnnotations] Ignored an invalid change event.")
        return
      }
      listener(parsed.data)
    }
    ipcRenderer.on("contentAnnotations:changed", handler)
    return () => ipcRenderer.removeListener("contentAnnotations:changed", handler)
  },
  list: async (threadId: string) =>
    contentAnnotationListSchema.parse(await invokeIpc("contentAnnotations:list", { threadId })),
  create: async (input: CreateContentAnnotationInput) =>
    contentAnnotationSchema.parse(await invokeIpc("contentAnnotations:create", input)),
  update: async (input: UpdateContentAnnotationInput) =>
    contentAnnotationSchema.parse(await invokeIpc("contentAnnotations:update", input)),
  delete: async (input: DeleteContentAnnotationInput) =>
    contentAnnotationSchema.parse(await invokeIpc("contentAnnotations:delete", input))
}
