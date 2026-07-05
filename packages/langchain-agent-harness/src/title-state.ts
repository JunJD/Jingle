import { z } from "zod/v4"

export const jingleAgentTitleValue = z.string().nullable().optional()

export const jingleAgentTitleStateSchema = z.object({
  title: jingleAgentTitleValue
})
