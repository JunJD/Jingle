import { z } from "zod/v4"

export interface ToolCallDisplay {
  description: string
  title: string
}

export const toolCallDisplaySchema = z
  .object({
    description: z.string().trim().min(1),
    title: z.string().trim().min(1)
  })
  .strict()

export const extensionToolCallPresentationSchema = z
  .object({
    access: z.enum(["read", "write", "external"]),
    capabilityDisplayName: z.string().trim().min(1).optional(),
    capabilityTitle: z.string().trim().min(1).optional(),
    kind: z.literal("extension"),
    profileTitle: z.string().trim().min(1).optional(),
    sourceTitle: z.string().trim().min(1).optional()
  })
  .strict()
  .transform((value, ctx) => {
    const capabilityDisplayName = value.capabilityDisplayName ?? value.profileTitle
    const capabilityTitle = value.capabilityTitle ?? value.sourceTitle

    if (!capabilityDisplayName) {
      ctx.addIssue({
        code: "custom",
        message: "Extension tool presentation must declare capabilityDisplayName.",
        path: ["capabilityDisplayName"]
      })
    }

    if (!capabilityTitle) {
      ctx.addIssue({
        code: "custom",
        message: "Extension tool presentation must declare capabilityTitle.",
        path: ["capabilityTitle"]
      })
    }

    return {
      access: value.access,
      capabilityDisplayName: capabilityDisplayName ?? "",
      capabilityTitle: capabilityTitle ?? "",
      kind: value.kind
    }
  })

export const extensionToolCallUiSchema = z
  .object({
    display: toolCallDisplaySchema,
    presentation: extensionToolCallPresentationSchema
  })
  .strict()

export type ExtensionToolCallPresentation = z.infer<typeof extensionToolCallPresentationSchema>
export type ExtensionToolCallUi = z.infer<typeof extensionToolCallUiSchema>

export function isExtensionToolCallPresentation(value: unknown): boolean {
  return extensionToolCallPresentationSchema.safeParse(value).success
}
