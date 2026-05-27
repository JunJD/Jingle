export const APPLE_REMINDERS_EXTENSION_ID = "apple-reminders" as const
export const APPLE_REMINDERS_SOURCE_ID = "appleReminders" as const
export const APPLE_REMINDERS_RPC_METHOD_GET_DATA = "get-data" as const
export const APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER = "create-reminder" as const
export const APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED = "set-reminder-completed" as const
export const APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER = "delete-reminder" as const
export const APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER = "show-reminder" as const

export const APPLE_REMINDERS_RPC_METHODS = [
  APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER,
  APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER,
  APPLE_REMINDERS_RPC_METHOD_GET_DATA,
  APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED,
  APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER
] as const

export type AppleReminderPriority = "high" | "low" | "medium" | null

export interface AppleReminderList {
  color: string
  id: string
  isDefault: boolean
  title: string
}

export interface AppleReminder {
  completionDate: string | null
  creationDate: string | null
  dueDate: string | null
  id: string
  isCompleted: boolean
  list: AppleReminderList | null
  notes: string
  openUrl: string
  priority: AppleReminderPriority
  title: string
}

export interface AppleRemindersData {
  lists: AppleReminderList[]
  reminders: AppleReminder[]
}

export interface GetAppleRemindersDataRequest {
  includeCompleted?: boolean
  limit?: number
}

export interface CreateAppleReminderRequest {
  dueDate?: string | null
  listId?: string
  notes?: string
  priority?: AppleReminderPriority
  title: string
}

export interface DeleteAppleReminderRequest {
  reminderId: string
}

export interface ShowAppleReminderRequest {
  reminderId: string
}

export interface SetAppleReminderCompletedRequest {
  completed: boolean
  reminderId: string
}
