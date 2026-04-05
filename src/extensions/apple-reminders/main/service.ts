import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { defineNativeExtensionService } from "../../../main/services/native-extensions/sdk"
import type {
  AppleReminder,
  AppleRemindersData,
  CreateAppleReminderRequest,
  DeleteAppleReminderRequest,
  SetAppleReminderCompletedRequest,
  ShowAppleReminderRequest
} from "../src/contracts"
import {
  APPLE_REMINDERS_EXTENSION_ID,
  APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER,
  APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER,
  APPLE_REMINDERS_RPC_METHOD_GET_DATA,
  APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED,
  APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER
} from "../src/contracts"

const execFileAsync = promisify(execFile)

const REMINDERS_JXA_SCRIPT = String.raw`
function toDateOnlyString(value) {
  var year = value.getFullYear()
  var month = String(value.getMonth() + 1).padStart(2, "0")
  var day = String(value.getDate()).padStart(2, "0")
  return year + "-" + month + "-" + day
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : null
}

function toOptionalString(value) {
  return value === undefined || value === null ? "" : String(value)
}

function normalizeReminderOpenUrl(reminderId) {
  return reminderId.indexOf("x-apple-reminder://") === 0
    ? reminderId
    : "x-apple-reminderkit://REMCDReminder/" + encodeURIComponent(reminderId)
}

function toPriority(value) {
  if (typeof value !== "number" || value <= 0) {
    return null
  }

  if (value <= 4) {
    return "high"
  }

  if (value === 5) {
    return "medium"
  }

  return "low"
}

function toNativePriority(value) {
  if (value === "high") {
    return 1
  }

  if (value === "medium") {
    return 5
  }

  if (value === "low") {
    return 9
  }

  return 0
}

function serializeList(listProperties, defaultListId) {
  var listId = toOptionalString(listProperties.id)

  return {
    color: toOptionalString(listProperties.color),
    id: listId,
    isDefault: listId.length > 0 && listId === defaultListId,
    title: toOptionalString(listProperties.name)
  }
}

function serializeReminder(reminderProperties, listProperties, defaultListId) {
  var reminderId = toOptionalString(reminderProperties.id)
  var allDayDueDate = reminderProperties.alldayDueDate
  var dueDate = reminderProperties.dueDate
  var completionDate = reminderProperties.completionDate
  var creationDate = reminderProperties.creationDate

  return {
    completionDate: completionDate ? toIsoString(completionDate) : null,
    creationDate: creationDate ? toIsoString(creationDate) : null,
    dueDate: allDayDueDate
      ? toDateOnlyString(allDayDueDate)
      : dueDate
        ? toIsoString(dueDate)
        : null,
    id: reminderId,
    isCompleted: reminderProperties.completed === true,
    list: listProperties ? serializeList(listProperties, defaultListId) : null,
    notes: toOptionalString(reminderProperties.body),
    openUrl: normalizeReminderOpenUrl(reminderId),
    priority: toPriority(Number(reminderProperties.priority || 0)),
    title: toOptionalString(reminderProperties.name)
  }
}

function findListById(app, listId) {
  var lists = app.lists()

  for (var index = 0; index < lists.length; index += 1) {
    if (toOptionalString(lists[index].properties().id) === listId) {
      return lists[index]
    }
  }

  return null
}

function findReminderRecord(app, reminderId) {
  var lists = app.lists()

  for (var listIndex = 0; listIndex < lists.length; listIndex += 1) {
    var list = lists[listIndex]
    var reminders = list.reminders()

    for (var reminderIndex = 0; reminderIndex < reminders.length; reminderIndex += 1) {
      var reminder = reminders[reminderIndex]
      if (toOptionalString(reminder.properties().id) === reminderId) {
        return {
          list: list,
          reminder: reminder
        }
      }
    }
  }

  throw new Error("Reminder not found")
}

function parseDueDate(value) {
  if (!value) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    var parts = value.split("-").map(function (entry) {
      return Number(entry)
    })

    return {
      kind: "date-only",
      value: new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0)
    }
  }

  return {
    kind: "date-time",
    value: new Date(value)
  }
}

function setReminderDueDate(reminder, value) {
  var parsed = parseDueDate(value)

  if (!parsed) {
    return
  }

  if (parsed.kind === "date-only") {
    reminder.alldayDueDate = parsed.value
    return
  }

  reminder.dueDate = parsed.value
}

function getData(app) {
  var defaultList = app.defaultList()
  var defaultListId = defaultList ? toOptionalString(defaultList.properties().id) : ""
  var lists = app.lists()

  return {
    lists: lists.map(function (list) {
      return serializeList(list.properties(), defaultListId)
    }),
    reminders: lists.flatMap(function (list) {
      var listProperties = list.properties()
      return list.reminders().map(function (reminder) {
        return serializeReminder(reminder.properties(), listProperties, defaultListId)
      })
    })
  }
}

function createReminder(app, payload) {
  var targetList = payload.listId ? findListById(app, payload.listId) : app.defaultList()
  if (!targetList) {
    throw new Error("Target reminder list not found")
  }

  var reminder = app.make({
    at: targetList,
    new: "reminder",
    withProperties: {
      body: payload.notes || "",
      name: payload.title
    }
  })

  reminder.priority = toNativePriority(payload.priority || null)
  setReminderDueDate(reminder, payload.dueDate || null)

  var defaultList = app.defaultList()
  var defaultListId = defaultList ? toOptionalString(defaultList.properties().id) : ""
  return serializeReminder(
    reminder.properties(),
    targetList.properties(),
    defaultListId
  )
}

function setReminderCompleted(app, payload) {
  var record = findReminderRecord(app, payload.reminderId)
  record.reminder.completed = payload.completed === true

  var defaultList = app.defaultList()
  var defaultListId = defaultList ? toOptionalString(defaultList.properties().id) : ""
  return serializeReminder(
    record.reminder.properties(),
    record.list.properties(),
    defaultListId
  )
}

function deleteReminder(app, payload) {
  var record = findReminderRecord(app, payload.reminderId)
  app.delete(record.reminder)
  return {
    reminderId: payload.reminderId
  }
}

function showReminder(app, payload) {
  var record = findReminderRecord(app, payload.reminderId)
  app.show(record.reminder)
  return null
}

function run(argv) {
  var request = JSON.parse(argv[0] || "{}")
  var app = Application("Reminders")
  app.includeStandardAdditions = true

  switch (request.method) {
    case "create-reminder":
      return JSON.stringify(createReminder(app, request.payload || {}))
    case "delete-reminder":
      return JSON.stringify(deleteReminder(app, request.payload || {}))
    case "get-data":
      return JSON.stringify(getData(app))
    case "set-reminder-completed":
      return JSON.stringify(setReminderCompleted(app, request.payload || {}))
    case "show-reminder":
      return JSON.stringify(showReminder(app, request.payload || {}))
    default:
      throw new Error("Unknown method: " + request.method)
  }
}
`

function assertAppleRemindersAvailable(): void {
  if (process.platform !== "darwin") {
    throw new Error("Apple Reminders is only available on macOS.")
  }
}

function normalizeAppleRemindersError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error)

  if (message.includes("timed out")) {
    return new Error(
      "Timed out while talking to Reminders. Allow automation access if macOS is showing a permission prompt, then try again."
    )
  }

  if (
    message.includes("Not authorised") ||
    message.includes("not authorized") ||
    message.includes("not permitted") ||
    message.includes("(-1743)")
  ) {
    return new Error(
      "Openwork needs permission to control Reminders. Grant automation access in System Settings and try again."
    )
  }

  return new Error(message)
}

async function invokeAppleReminders<TResult>(method: string, payload: unknown): Promise<TResult> {
  assertAppleRemindersAvailable()

  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        REMINDERS_JXA_SCRIPT,
        JSON.stringify({
          method,
          payload
        })
      ],
      {
        maxBuffer: 1024 * 1024 * 4,
        timeout: 10_000
      }
    )

    return JSON.parse(stdout.trim() || "null") as TResult
  } catch (error) {
    throw normalizeAppleRemindersError(error)
  }
}

async function getAppleRemindersData(): Promise<AppleRemindersData> {
  return invokeAppleReminders<AppleRemindersData>(APPLE_REMINDERS_RPC_METHOD_GET_DATA, {})
}

async function createAppleReminder(payload: CreateAppleReminderRequest): Promise<AppleReminder> {
  return invokeAppleReminders<AppleReminder>(APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER, payload)
}

async function setAppleReminderCompleted(
  payload: SetAppleReminderCompletedRequest
): Promise<AppleReminder> {
  return invokeAppleReminders<AppleReminder>(
    APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED,
    payload
  )
}

async function deleteAppleReminder(
  payload: DeleteAppleReminderRequest
): Promise<{ reminderId: string }> {
  return invokeAppleReminders<{ reminderId: string }>(
    APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER,
    payload
  )
}

async function showAppleReminder(payload: ShowAppleReminderRequest): Promise<null> {
  return invokeAppleReminders<null>(APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER, payload)
}

const appleRemindersNativeExtensionService = defineNativeExtensionService(
  APPLE_REMINDERS_EXTENSION_ID,
  {
    [APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER]: createAppleReminder,
    [APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER]: deleteAppleReminder,
    [APPLE_REMINDERS_RPC_METHOD_GET_DATA]: getAppleRemindersData,
    [APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED]: setAppleReminderCompleted,
    [APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER]: showAppleReminder
  }
)

export default appleRemindersNativeExtensionService
