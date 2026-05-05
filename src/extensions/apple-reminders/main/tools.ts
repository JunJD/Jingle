import { z } from "zod/v4"
import type { ExtensionToolDefinition } from "@shared/extension-sources"
import type {
  AppleReminder,
  AppleRemindersData,
  CreateAppleReminderRequest
} from "../src/contracts"
import { createAppleReminder, getAppleRemindersData } from "./service"

const listRemindersInputSchema = z.object({
  includeCompleted: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(25)
})

const createReminderInputSchema = z.object({
  dueDate: z.string().nullable().optional(),
  listId: z.string().optional(),
  notes: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).nullable().optional(),
  title: z.string().trim().min(1)
})

type ListRemindersInput = z.infer<typeof listRemindersInputSchema>
type CreateReminderInput = z.infer<typeof createReminderInputSchema>

export interface AppleRemindersToolServices {
  createReminder: (payload: CreateAppleReminderRequest) => Promise<AppleReminder>
  getData: () => Promise<AppleRemindersData>
}

const defaultAppleRemindersToolServices: AppleRemindersToolServices = {
  createReminder: createAppleReminder,
  getData: getAppleRemindersData
}

function selectReminders(data: AppleRemindersData, input: ListRemindersInput): AppleRemindersData {
  return {
    lists: data.lists,
    reminders: data.reminders
      .filter((reminder) => input.includeCompleted || !reminder.isCompleted)
      .slice(0, input.limit)
  }
}

export function createAppleRemindersTools(
  services: AppleRemindersToolServices = defaultAppleRemindersToolServices
): ExtensionToolDefinition[] {
  const listRemindersTool: ExtensionToolDefinition<ListRemindersInput, AppleRemindersData> = {
    access: "read",
    description: "List Apple Reminders tasks and lists.",
    handler: async (_ctx, input) => selectReminders(await services.getData(), input),
    inputSchema: listRemindersInputSchema,
    name: "listReminders",
    title: "List Reminders"
  }
  const createReminderTool: ExtensionToolDefinition<CreateReminderInput, AppleReminder> = {
    access: "write",
    description: "Create a new Apple Reminders task.",
    handler: (_ctx, input) => services.createReminder(input),
    inputSchema: createReminderInputSchema,
    name: "createReminder",
    title: "Create Reminder"
  }

  return [listRemindersTool, createReminderTool]
}
