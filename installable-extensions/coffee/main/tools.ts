import { z } from "zod/v4"
import type { ExtensionToolDefinition } from "@jingle/extension-api"
import type { CoffeePreferences, CoffeeStatus } from "../contracts"
import { getCoffeeStatus, startCoffee, stopCoffee } from "./service"

const caffeinateForInputSchema = z.object({
  hours: z.number().int().min(0).optional().default(0),
  minutes: z.number().int().min(0).optional().default(0),
  seconds: z.number().int().min(0).optional().default(0)
})

type CaffeinateForInput = z.infer<typeof caffeinateForInputSchema>

function toDurationSeconds(input: CaffeinateForInput): number {
  const totalSeconds = input.hours * 3_600 + input.minutes * 60 + input.seconds
  if (totalSeconds <= 0) {
    throw new Error("Specify a Coffee duration greater than zero seconds.")
  }

  return totalSeconds
}

export function createCoffeeTools(): ExtensionToolDefinition[] {
  const checkStatusTool: ExtensionToolDefinition<Record<string, never>, CoffeeStatus> = {
    access: "read",
    description: "Check whether the Mac is currently caffeinated.",
    handler: () => getCoffeeStatus(),
    inputSchema: z.object({}),
    name: "checkCaffeinationStatus",
    title: "Check Caffeination Status"
  }
  const caffeinateTool: ExtensionToolDefinition<Record<string, never>, CoffeeStatus> = {
    access: "external",
    description: "Keep the Mac awake until Coffee is manually stopped.",
    handler: (ctx) =>
      startCoffee({
        preferences: ctx.extensionPreferences as CoffeePreferences
      }),
    inputSchema: z.object({}),
    name: "caffeinate",
    title: "Caffeinate"
  }
  const caffeinateForTool: ExtensionToolDefinition<CaffeinateForInput, CoffeeStatus> = {
    access: "external",
    description: "Keep the Mac awake for a specified duration.",
    handler: (ctx, input) =>
      startCoffee({
        durationSeconds: toDurationSeconds(input),
        preferences: ctx.extensionPreferences as CoffeePreferences
      }),
    inputSchema: caffeinateForInputSchema,
    name: "caffeinateFor",
    title: "Caffeinate for Duration"
  }
  const decaffeinateTool: ExtensionToolDefinition<Record<string, never>, CoffeeStatus> = {
    access: "external",
    description: "Stop Coffee and allow the Mac to sleep normally.",
    handler: () => stopCoffee(),
    inputSchema: z.object({}),
    name: "decaffeinate",
    title: "Decaffeinate"
  }

  return [checkStatusTool, caffeinateTool, caffeinateForTool, decaffeinateTool]
}
