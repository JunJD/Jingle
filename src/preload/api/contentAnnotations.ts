import {
  contentAnnotationListSchema,
  contentAnnotationSchema,
  type CreateContentAnnotationInput,
  type DeleteContentAnnotationInput,
  type UpdateContentAnnotationInput
} from "@shared/content-annotation"
import { invokeIpc } from "../ipc"

export const contentAnnotationsApi = {
  list: async (threadId: string) =>
    contentAnnotationListSchema.parse(await invokeIpc("contentAnnotations:list", { threadId })),
  create: async (input: CreateContentAnnotationInput) =>
    contentAnnotationSchema.parse(await invokeIpc("contentAnnotations:create", input)),
  update: async (input: UpdateContentAnnotationInput) =>
    contentAnnotationSchema.parse(await invokeIpc("contentAnnotations:update", input)),
  delete: async (input: DeleteContentAnnotationInput) =>
    contentAnnotationSchema.parse(await invokeIpc("contentAnnotations:delete", input))
}
