import { z } from "zod/v4"

export const toolCallDisplaySchema = z
  .object({
    description: z.string().trim().min(1),
    title: z.string().trim().min(1)
  })
  .strict()

export const extensionToolCallPresentationSchema = z
  .object({
    access: z.enum(["read", "write", "external"]),
    kind: z.literal("extension"),
    profileTitle: z.string().trim().min(1),
    sourceTitle: z.string().trim().min(1)
  })
  .strict()

export const extensionToolCallUiSchema = z
  .object({
    display: toolCallDisplaySchema,
    presentation: extensionToolCallPresentationSchema
  })
  .strict()

export type ToolCallDisplay = z.infer<typeof toolCallDisplaySchema>
export type ExtensionToolCallPresentation = z.infer<typeof extensionToolCallPresentationSchema>
export type ExtensionToolCallUi = z.infer<typeof extensionToolCallUiSchema>

export function isExtensionToolCallPresentation(
  value: unknown
): value is ExtensionToolCallPresentation {
  return extensionToolCallPresentationSchema.safeParse(value).success
}
