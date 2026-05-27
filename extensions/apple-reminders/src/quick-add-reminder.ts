import { createAppleReminder, getAppleRemindersData } from "./runtime-client"
import type { AppleReminderList } from "./contracts"

function normalizeListName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "")
}

function toDateOnly(offsetDays: number): string {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() + offsetDays)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseQuickAddInput(input: string, lists: AppleReminderList[]) {
  let remaining = input.trim()
  let listId: string | undefined
  let dueDate: string | undefined
  let priority: "high" | undefined

  const listMatch = remaining.match(/(?:^|\s)[#@]([a-z0-9_-]+)/i)
  if (listMatch) {
    const matchedList = lists.find(
      (list) => normalizeListName(list.title) === normalizeListName(listMatch[1])
    )
    if (matchedList) {
      listId = matchedList.id
      remaining = remaining.replace(listMatch[0], " ")
    }
  }

  if (/\btomorrow\b/i.test(remaining)) {
    dueDate = toDateOnly(1)
    remaining = remaining.replace(/\btomorrow\b/gi, " ")
  } else if (/\btoday\b/i.test(remaining)) {
    dueDate = toDateOnly(0)
    remaining = remaining.replace(/\btoday\b/gi, " ")
  } else if (/\bnext week\b/i.test(remaining)) {
    dueDate = toDateOnly(7)
    remaining = remaining.replace(/\bnext week\b/gi, " ")
  }

  if (/\b(urgent|important)\b/i.test(remaining) || remaining.includes("!")) {
    priority = "high"
    remaining = remaining.replace(/\b(urgent|important)\b/gi, " ").replace(/!/g, " ")
  }

  const title = remaining.replace(/\s+/g, " ").trim() || input.trim()

  return {
    dueDate,
    listId,
    priority,
    title
  }
}

export default async function AppleRemindersQuickAddReminder(context: {
  navigation?: {
    openCommand: (address: {
      commandName: string
      extensionName: string
      kind: "extension-command"
    }) => Promise<void>
  }
  seedQuery: string
}): Promise<void> {
  const seedQuery = context.seedQuery.trim()

  if (!seedQuery) {
    await context.navigation?.openCommand({
      commandName: "create-reminder",
      extensionName: "apple-reminders",
      kind: "extension-command"
    })
    return
  }

  const data = await getAppleRemindersData()
  const parsed = parseQuickAddInput(seedQuery, data.lists)

  await createAppleReminder({
    dueDate: parsed.dueDate,
    listId: parsed.listId,
    priority: parsed.priority ?? null,
    title: parsed.title
  })
}
