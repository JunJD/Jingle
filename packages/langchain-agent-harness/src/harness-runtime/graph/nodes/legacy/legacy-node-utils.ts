
import { ReducedValue, StateSchema } from "@langchain/langgraph"
import {
  interopSafeParseAsync,
  interopZodObjectMakeFieldsOptional
} from "@langchain/core/utils/types"
import { z } from "zod/v4"
/**
 * Helper function to initialize middleware state defaults.
 * This is used to ensure all middleware state properties are initialized.
 *
 * Private properties (starting with _) are automatically made optional since
 * users cannot provide them when invoking the agent.
 */
async function initializeMiddlewareStates(middlewareList: readonly any[], state: any) {
  const middlewareStates: Record<string, unknown> = {}
  for (const middleware of middlewareList) {
    /**
     * skip middleware if it doesn't have a state schema
     */
    if (!middleware.stateSchema) continue
    let zodSchema: any = middleware.stateSchema
    if (StateSchema.isInstance(middleware.stateSchema)) {
      const zodShape: Record<string, any> = {}
      for (const [key, field] of Object.entries(middleware.stateSchema.fields))
        if (ReducedValue.isInstance(field)) zodShape[key] = field.inputSchema || field.valueSchema
        else zodShape[key] = field
      zodSchema = z.object(zodShape)
    }
    const parseResult = await interopSafeParseAsync(
      interopZodObjectMakeFieldsOptional(zodSchema, (key) => key.startsWith("_")),
      state
    )
    if (parseResult.success) {
      Object.assign(middlewareStates, parseResult.data)
      continue
    }
    /**
     * If safeParse fails, there are required public fields missing.
     * Note: Zod v3 uses message "Required", Zod v4 uses "Invalid input: expected X, received undefined"
     */
    const requiredFields = parseResult.error.issues
      .filter((issue) => issue.code === "invalid_type")
      .map((issue) => `  - ${issue.path.join(".")}: Required`)
      .join("\n")
    throw new Error(
      `Middleware "${middleware.name}" has required state fields that must be initialized:\n${requiredFields}\n\nTo fix this, either:\n1. Provide default values in your middleware's state schema using .default():\n   stateSchema: z.object({\n     myField: z.string().default("default value")\n   })\n\n2. Or make the fields optional using .optional():\n   stateSchema: z.object({\n     myField: z.string().optional()\n   })\n\n3. Or ensure you pass these values when invoking the agent:\n   agent.invoke({\n     messages: [...],\n     ${parseResult.error.issues[0]?.path.join(".")}: "value"\n   })`
    )
  }
  return middlewareStates
}
/**
 * Users can define private and public state for a middleware. Private state properties start with an underscore.
 * This function will return the private state properties from the state schema, making all of them optional.
 * @param stateSchema - The middleware state schema
 * @returns A new schema containing only the private properties (underscore-prefixed), all made optional
 */
function derivePrivateState(stateSchema: any) {
  const builtInStateSchema = {
    messages: z.custom(() => []),
    structuredResponse: z.any().optional()
  }
  if (!stateSchema) return z.object(builtInStateSchema)
  let shape: Record<string, any>
  if (StateSchema.isInstance(stateSchema)) {
    shape = {}
    for (const [key, field] of Object.entries(stateSchema.fields))
      if (ReducedValue.isInstance(field)) shape[key] = field.inputSchema || field.valueSchema
      else shape[key] = field
  } else shape = stateSchema.shape
  const privateShape: Record<string, any> = { ...builtInStateSchema }
  for (const [key, value] of Object.entries(shape))
    if (key.startsWith("_")) privateShape[key] = value.optional()
    else privateShape[key] = value
  return z.object(privateShape)
}
export {
  derivePrivateState,
  initializeMiddlewareStates
}
