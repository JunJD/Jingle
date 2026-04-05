import { createNativeExtensionClient, defineNativeExtensionClientMethod, useNativeCommandPreferences } from "../../api"
import type {
  AppleReminder,
  AppleRemindersData,
  CreateAppleReminderRequest,
  DeleteAppleReminderRequest,
  SetAppleReminderCompletedRequest,
  ShowAppleReminderRequest
} from "./contracts"
import {
  APPLE_REMINDERS_EXTENSION_ID,
  APPLE_REMINDERS_RPC_METHODS
} from "./contracts"

export function useAppleRemindersCommandPreferences<T extends object>() {
  return useNativeCommandPreferences<T>()
}

export const appleRemindersClient = createNativeExtensionClient(
  APPLE_REMINDERS_EXTENSION_ID,
  APPLE_REMINDERS_RPC_METHODS,
  {
    "create-reminder": defineNativeExtensionClientMethod<
      CreateAppleReminderRequest,
      AppleReminder
    >(),
    "delete-reminder": defineNativeExtensionClientMethod<
      DeleteAppleReminderRequest,
      { reminderId: string }
    >(),
    "get-data": defineNativeExtensionClientMethod<Record<string, never>, AppleRemindersData>(),
    "set-reminder-completed": defineNativeExtensionClientMethod<
      SetAppleReminderCompletedRequest,
      AppleReminder
    >(),
    "show-reminder": defineNativeExtensionClientMethod<ShowAppleReminderRequest, void>()
  }
)

export function getAppleRemindersData(): Promise<AppleRemindersData> {
  return appleRemindersClient["get-data"]({})
}

export function createAppleReminder(
  payload: CreateAppleReminderRequest
): Promise<AppleReminder> {
  return appleRemindersClient["create-reminder"](payload)
}

export function setAppleReminderCompleted(
  payload: SetAppleReminderCompletedRequest
): Promise<AppleReminder> {
  return appleRemindersClient["set-reminder-completed"](payload)
}

export function deleteAppleReminder(
  payload: DeleteAppleReminderRequest
): Promise<{ reminderId: string }> {
  return appleRemindersClient["delete-reminder"](payload)
}

export function showAppleReminder(payload: ShowAppleReminderRequest): Promise<void> {
  return appleRemindersClient["show-reminder"](payload)
}
