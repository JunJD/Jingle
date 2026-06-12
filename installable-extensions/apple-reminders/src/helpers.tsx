import { Calendar, CheckCircle2, Circle, Clock3 } from "lucide-react"
import type { ReactNode } from "react"
import type { AppleReminder, AppleReminderList } from "../contracts"

export type ReminderFilterValue = "all" | "overdue" | "scheduled" | "today" | string

export interface ReminderSection {
  id: string
  items: AppleReminder[]
  title: string
}

function toDateParts(value: Date): { day: number; month: number; year: number } {
  return {
    day: value.getDate(),
    month: value.getMonth(),
    year: value.getFullYear()
  }
}

export function isDateOnlyValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function parseReminderDate(value: string): Date {
  if (isDateOnlyValue(value)) {
    const [year, month, day] = value.split("-").map((entry) => Number(entry))
    return new Date(year, month - 1, day, 12, 0, 0, 0)
  }

  return new Date(value)
}

export function formatReminderDateLabel(value: string): string {
  const date = parseReminderDate(value)
  const now = new Date()
  const today = toDateParts(now)
  const target = toDateParts(date)
  const tomorrow = toDateParts(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12))

  if (target.year === today.year && target.month === today.month && target.day === today.day) {
    if (isDateOnlyValue(value)) {
      return "Today"
    }

    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })
  }

  if (
    target.year === tomorrow.year &&
    target.month === tomorrow.month &&
    target.day === tomorrow.day
  ) {
    if (isDateOnlyValue(value)) {
      return "Tomorrow"
    }

    return `Tomorrow ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })}`
  }

  return date.toLocaleString([], {
    day: "numeric",
    hour: isDateOnlyValue(value) ? undefined : "numeric",
    minute: isDateOnlyValue(value) ? undefined : "2-digit",
    month: "short"
  })
}

export function isReminderDueToday(reminder: AppleReminder): boolean {
  if (!reminder.dueDate) {
    return false
  }

  const date = parseReminderDate(reminder.dueDate)
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

export function isReminderDueTomorrow(reminder: AppleReminder): boolean {
  if (!reminder.dueDate) {
    return false
  }

  const date = parseReminderDate(reminder.dueDate)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)

  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  )
}

export function isReminderOverdue(reminder: AppleReminder): boolean {
  if (!reminder.dueDate || reminder.isCompleted) {
    return false
  }

  if (isDateOnlyValue(reminder.dueDate)) {
    const dueDate = parseReminderDate(reminder.dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return dueDate.getTime() < today.getTime()
  }

  return parseReminderDate(reminder.dueDate).getTime() < Date.now()
}

export function isReminderScheduled(reminder: AppleReminder): boolean {
  return Boolean(reminder.dueDate)
}

export function compareRemindersByDueDate(left: AppleReminder, right: AppleReminder): number {
  if (!left.dueDate && !right.dueDate) {
    return left.title.localeCompare(right.title)
  }

  if (!left.dueDate) {
    return 1
  }

  if (!right.dueDate) {
    return -1
  }

  return parseReminderDate(left.dueDate).getTime() - parseReminderDate(right.dueDate).getTime()
}

export function filterRemindersByView(
  reminders: AppleReminder[],
  value: ReminderFilterValue
): AppleReminder[] {
  switch (value) {
    case "all":
      return reminders
    case "overdue":
      return reminders.filter((reminder) => isReminderOverdue(reminder))
    case "scheduled":
      return reminders.filter((reminder) => isReminderScheduled(reminder))
    case "today":
      return reminders.filter(
        (reminder) => isReminderOverdue(reminder) || isReminderDueToday(reminder)
      )
    default:
      return reminders.filter((reminder) => reminder.list?.id === value)
  }
}

function groupTodayRemindersByTime(reminders: AppleReminder[]): ReminderSection[] {
  const groups = {
    afternoon: [] as AppleReminder[],
    evening: [] as AppleReminder[],
    morning: [] as AppleReminder[],
    untimed: [] as AppleReminder[]
  }

  for (const reminder of reminders) {
    if (!reminder.dueDate || isDateOnlyValue(reminder.dueDate)) {
      groups.untimed.push(reminder)
      continue
    }

    const hour = parseReminderDate(reminder.dueDate).getHours()
    if (hour < 12) {
      groups.morning.push(reminder)
    } else if (hour < 17) {
      groups.afternoon.push(reminder)
    } else {
      groups.evening.push(reminder)
    }
  }

  return [
    { id: "today-morning", items: groups.morning, title: "Morning" },
    { id: "today-afternoon", items: groups.afternoon, title: "Afternoon" },
    { id: "today-evening", items: groups.evening, title: "Evening" },
    { id: "today-untimed", items: groups.untimed, title: "Untimed" }
  ].filter((section) => section.items.length > 0)
}

export function buildReminderSections(params: {
  reminders: AppleReminder[]
  showCompleted: boolean
  useTimeOfDayGrouping: boolean
}): ReminderSection[] {
  const incomplete = params.reminders
    .filter((reminder) => !reminder.isCompleted)
    .slice()
    .sort(compareRemindersByDueDate)
  const completed = params.showCompleted
    ? params.reminders
        .filter((reminder) => reminder.isCompleted)
        .slice()
        .sort((left, right) => {
          const leftDate = left.completionDate ? new Date(left.completionDate).getTime() : 0
          const rightDate = right.completionDate ? new Date(right.completionDate).getTime() : 0
          return rightDate - leftDate
        })
    : []
  const overdue = incomplete.filter((reminder) => isReminderOverdue(reminder))
  const today = incomplete.filter(
    (reminder) => reminder.dueDate && !isReminderOverdue(reminder) && isReminderDueToday(reminder)
  )
  const tomorrow = incomplete.filter((reminder) => isReminderDueTomorrow(reminder))
  const upcoming = incomplete.filter(
    (reminder) =>
      reminder.dueDate &&
      !isReminderOverdue(reminder) &&
      !isReminderDueToday(reminder) &&
      !isReminderDueTomorrow(reminder)
  )
  const unscheduled = incomplete.filter((reminder) => !reminder.dueDate)
  const sections: ReminderSection[] = []

  if (overdue.length > 0) {
    sections.push({ id: "overdue", items: overdue, title: "Overdue" })
  }

  if (today.length > 0) {
    if (params.useTimeOfDayGrouping) {
      sections.push(...groupTodayRemindersByTime(today))
    } else {
      sections.push({ id: "today", items: today, title: "Today" })
    }
  }

  if (tomorrow.length > 0) {
    sections.push({ id: "tomorrow", items: tomorrow, title: "Tomorrow" })
  }

  if (upcoming.length > 0) {
    sections.push({ id: "upcoming", items: upcoming, title: "Upcoming" })
  }

  if (unscheduled.length > 0) {
    sections.push({ id: "unscheduled", items: unscheduled, title: "No Due Date" })
  }

  if (completed.length > 0) {
    sections.push({ id: "completed", items: completed, title: "Completed" })
  }

  return sections
}

export function getReminderKeywords(reminder: AppleReminder): string[] {
  return [
    reminder.title,
    reminder.notes,
    reminder.list?.title ?? "",
    reminder.priority ?? "",
    reminder.dueDate ?? "",
    reminder.isCompleted ? "completed" : "open"
  ]
}

export function getReminderIcon(reminder: AppleReminder): ReactNode {
  if (reminder.isCompleted) {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  }

  if (isReminderOverdue(reminder)) {
    return <Clock3 className="h-4 w-4 text-red-500" />
  }

  if (reminder.dueDate) {
    return <Calendar className="h-4 w-4 text-sky-500" />
  }

  return <Circle className="h-4 w-4 text-muted-foreground" />
}

export function getReminderAccessories(params: {
  displayCompletionDate: boolean
  reminder: AppleReminder
  showListName: boolean
}): ReactNode {
  const { displayCompletionDate, reminder, showListName } = params
  const parts: string[] = []

  if (showListName && reminder.list) {
    parts.push(reminder.list.title)
  }

  if (reminder.priority) {
    parts.push(reminder.priority)
  }

  if (reminder.isCompleted && displayCompletionDate && reminder.completionDate) {
    parts.push(new Date(reminder.completionDate).toLocaleString())
  } else if (reminder.dueDate) {
    parts.push(formatReminderDateLabel(reminder.dueDate))
  }

  return parts.length > 0 ? parts.join(" · ") : null
}

export function getReminderFilterOptions(
  lists: AppleReminderList[]
): Array<{ title: string; value: ReminderFilterValue }> {
  return [
    { title: "Today", value: "today" },
    { title: "Overdue", value: "overdue" },
    { title: "Scheduled", value: "scheduled" },
    { title: "All", value: "all" },
    ...lists.map((list) => ({
      title: list.title,
      value: list.id
    }))
  ]
}

export function buildReminderMenuBarTitle(params: {
  count: number
  firstReminderTitle: string | null
  hideWhenEmpty: boolean
  titleType: "count" | "firstReminder" | "nothing"
}): string {
  if (params.titleType === "nothing") {
    return ""
  }

  if (params.titleType === "firstReminder") {
    return params.firstReminderTitle ?? "Reminders"
  }

  if (params.hideWhenEmpty && params.count === 0) {
    return ""
  }

  return params.count > 0 ? String(params.count) : "Reminders"
}
