import { ReducedValue, StateSchema } from "@langchain/langgraph"
import { z } from "zod/v4"

export type JingleContextInclusionStateItem = {
  id: string
}

const jingleContextInclusionStateItemSchema = z
  .object({
    id: z.string()
  })
  .passthrough()

const jingleContextInclusionsSchema = z
  .array(jingleContextInclusionStateItemSchema)
  .default(() => [])

const jingleContextInclusionsUpdateSchema = z
  .array(jingleContextInclusionStateItemSchema)
  .optional()

export function upsertJingleContextInclusions<TInclusion extends JingleContextInclusionStateItem>(
  existing: readonly TInclusion[],
  incoming: readonly TInclusion[]
): TInclusion[] {
  const inclusions = [...existing]

  for (const inclusion of incoming) {
    const existingIndex = inclusions.findIndex((entry) => entry.id === inclusion.id)
    if (existingIndex >= 0) {
      inclusions[existingIndex] = inclusion
    } else {
      inclusions.push(inclusion)
    }
  }

  return inclusions
}

export const jingleAgentContextInclusionsValue = new ReducedValue(jingleContextInclusionsSchema, {
  inputSchema: jingleContextInclusionsUpdateSchema,
  reducer: (existing, update) =>
    update ? upsertJingleContextInclusions(existing, update) : existing
})

export const jingleAgentContextInclusionsStateSchema = new StateSchema({
  contextInclusions: jingleAgentContextInclusionsValue
})
