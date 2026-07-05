import { z } from "zod/v4"
import type { ExtensionToolDefinition } from "@jingle/extension-api"
import type {
  AppleReminder,
  AppleRemindersData,
  CreateAppleReminderRequest,
  DeleteAppleReminderRequest,
  GetAppleRemindersDataRequest,
  SetAppleReminderCompletedRequest,
  ShowAppleReminderRequest
} from "../contracts"
import {
  createAppleReminder,
  deleteAppleReminder,
  getAppleRemindersData,
  isAppleRemindersRequestError,
  setAppleReminderCompleted,
  showAppleReminder
} from "./service"

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

const reminderIdInputSchema = z.object({
  reminderId: z.string().trim().min(1)
})

type ListRemindersInput = z.infer<typeof listRemindersInputSchema>
type CreateReminderInput = z.infer<typeof createReminderInputSchema>
type ReminderIdInput = z.infer<typeof reminderIdInputSchema>

export interface AppleRemindersToolServices {
  createReminder: (payload: CreateAppleReminderRequest) => Promise<AppleReminder>
  deleteReminder: (payload: DeleteAppleReminderRequest) => Promise<{ reminderId: string }>
  getData: (payload?: GetAppleRemindersDataRequest) => Promise<AppleRemindersData>
  setReminderCompleted: (payload: SetAppleReminderCompletedRequest) => Promise<AppleReminder>
  showReminder: (payload: ShowAppleReminderRequest) => Promise<null>
}

const defaultAppleRemindersToolServices: AppleRemindersToolServices = {
  createReminder: createAppleReminder,
  deleteReminder: deleteAppleReminder,
  getData: getAppleRemindersData,
  setReminderCompleted: setAppleReminderCompleted,
  showReminder: showAppleReminder
}

function selectReminders(data: AppleRemindersData, input: ListRemindersInput): AppleRemindersData {
  return {
    lists: data.lists,
    reminders: data.reminders
      .filter((reminder) => input.includeCompleted || !reminder.isCompleted)
      .slice(0, input.limit)
  }
}

async function runAppleRemindersTool<TResult>(
  action: string,
  operation: () => Promise<TResult>
): Promise<TResult | string> {
  try {
    return await operation()
  } catch (error) {
    if (!isAppleRemindersRequestError(error)) {
      throw error
    }

    return `Apple Reminders ${action} failed. ${error.message}`
  }
}

export function createAppleRemindersTools(
  services: AppleRemindersToolServices = defaultAppleRemindersToolServices
): ExtensionToolDefinition[] {
  const listRemindersTool: ExtensionToolDefinition<
    ListRemindersInput,
    AppleRemindersData | string
  > = {
    access: "read",
    description: "List Apple Reminders tasks and lists.",
    handler: async (_ctx, input) =>
      runAppleRemindersTool("list reminders", async () =>
        selectReminders(await services.getData(input), input)
      ),
    inputSchema: listRemindersInputSchema,
    name: "listReminders",
    title: "List Reminders"
  }
  const createReminderTool: ExtensionToolDefinition<CreateReminderInput, AppleReminder | string> = {
    access: "write",
    description: "Create a new Apple Reminders task.",
    handler: (_ctx, input) =>
      runAppleRemindersTool("create reminder", () => services.createReminder(input)),
    inputSchema: createReminderInputSchema,
    name: "createReminder",
    title: "Create Reminder"
  }
  const completeReminderTool: ExtensionToolDefinition<ReminderIdInput, AppleReminder | string> = {
    access: "write",
    description: "Mark an Apple Reminders task as complete.",
    handler: (_ctx, input) =>
      runAppleRemindersTool("complete reminder", () =>
        services.setReminderCompleted({
          completed: true,
          reminderId: input.reminderId
        })
      ),
    inputSchema: reminderIdInputSchema,
    name: "completeReminder",
    title: "Complete Reminder"
  }
  const deleteReminderTool: ExtensionToolDefinition<
    ReminderIdInput,
    { reminderId: string } | string
  > = {
    access: "write",
    description: "Delete an Apple Reminders task.",
    handler: (_ctx, input) =>
      runAppleRemindersTool("delete reminder", () => services.deleteReminder(input)),
    inputSchema: reminderIdInputSchema,
    name: "deleteReminder",
    title: "Delete Reminder"
  }
  const openReminderTool: ExtensionToolDefinition<
    ReminderIdInput,
    { opened: true; reminderId: string } | string
  > = {
    access: "external",
    description: "Open an Apple Reminders task in the Reminders app.",
    handler: (_ctx, input) =>
      runAppleRemindersTool("open reminder", async () => {
        await services.showReminder(input)
        return {
          opened: true,
          reminderId: input.reminderId
        }
      }),
    inputSchema: reminderIdInputSchema,
    name: "openReminder",
    title: "Open Reminder"
  }

  return [
    listRemindersTool,
    createReminderTool,
    completeReminderTool,
    deleteReminderTool,
    openReminderTool
  ]
}
