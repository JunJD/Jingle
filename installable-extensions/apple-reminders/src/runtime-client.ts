import {
  createNativeExtensionClient,
  defineNativeExtensionClientMethod,
  useNativeCommandPreferences
} from "@jingle/extension-api"
import type {
  AppleReminder,
  AppleRemindersData,
  CreateAppleReminderRequest,
  DeleteAppleReminderRequest,
  GetAppleRemindersDataRequest,
  SetAppleReminderCompletedRequest,
  ShowAppleReminderRequest
} from "../contracts"
import { APPLE_REMINDERS_EXTENSION_ID, APPLE_REMINDERS_RPC_METHODS } from "../contracts"

export function useAppleRemindersCommandPreferences<T extends object>() {
  return useNativeCommandPreferences<T>()
}

export const appleRemindersRuntimeClient = createNativeExtensionClient(
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
    "get-data": defineNativeExtensionClientMethod<
      GetAppleRemindersDataRequest,
      AppleRemindersData
    >(),
    "set-reminder-completed": defineNativeExtensionClientMethod<
      SetAppleReminderCompletedRequest,
      AppleReminder
    >(),
    "show-reminder": defineNativeExtensionClientMethod<ShowAppleReminderRequest, void>()
  }
)

export function getAppleRemindersData(): Promise<AppleRemindersData> {
  return appleRemindersRuntimeClient["get-data"]({})
}

export function createAppleReminder(payload: CreateAppleReminderRequest): Promise<AppleReminder> {
  return appleRemindersRuntimeClient["create-reminder"](payload)
}

export function setAppleReminderCompleted(
  payload: SetAppleReminderCompletedRequest
): Promise<AppleReminder> {
  return appleRemindersRuntimeClient["set-reminder-completed"](payload)
}

export function deleteAppleReminder(
  payload: DeleteAppleReminderRequest
): Promise<{ reminderId: string }> {
  return appleRemindersRuntimeClient["delete-reminder"](payload)
}

export function showAppleReminder(payload: ShowAppleReminderRequest): Promise<void> {
  return appleRemindersRuntimeClient["show-reminder"](payload)
}
