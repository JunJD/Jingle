import { z } from "zod/v4"

export const launcherPresentationIdSchema = z.number().int().positive()

export const launcherShownEventSchema = z
  .object({
    presentationId: launcherPresentationIdSchema
  })
  .strict()

export const launcherPresentArgsSchema = z.tuple([launcherPresentationIdSchema])

export type LauncherShownEvent = z.infer<typeof launcherShownEventSchema>
