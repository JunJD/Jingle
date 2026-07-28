import { z } from "zod/v4"

export const launcherPresentationIdSchema = z.number().int().positive()
export const launcherViewportHeightSchema = z.number().finite().positive()

export const launcherShownEventSchema = z
  .object({
    presentationId: launcherPresentationIdSchema
  })
  .strict()

export const launcherPresentArgsSchema = z.tuple([launcherPresentationIdSchema])
export const launcherSetViewportHeightArgsSchema = z.tuple([launcherViewportHeightSchema])

export type LauncherShownEvent = z.infer<typeof launcherShownEventSchema>
