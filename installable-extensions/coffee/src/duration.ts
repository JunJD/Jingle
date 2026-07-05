export function formatCoffeeDuration(seconds: number): string {
  const units = [
    { label: "d", value: 86_400 },
    { label: "h", value: 3_600 },
    { label: "m", value: 60 },
    { label: "s", value: 1 }
  ]
  const parts: string[] = []
  let remaining = Math.max(0, Math.floor(seconds))

  for (const unit of units) {
    const amount = Math.floor(remaining / unit.value)
    remaining %= unit.value
    if (amount > 0) {
      parts.push(`${amount}${unit.label}`)
    }
  }

  return parts.join(" ") || "0s"
}

export function parseCoffeeDuration(input: {
  fallbackText?: string
  hours?: unknown
  minutes?: unknown
  seconds?: unknown
}): number {
  const explicitSeconds =
    readWholeNumber(input.hours) * 3_600 +
    readWholeNumber(input.minutes) * 60 +
    readWholeNumber(input.seconds)
  if (explicitSeconds > 0) {
    return explicitSeconds
  }

  const text = input.fallbackText?.trim()
  if (!text) {
    throw new Error("Set at least one duration argument.")
  }

  const bareMinuteMatch = /^(\d+)$/.exec(text)
  const bareMinutes = bareMinuteMatch ? Number.parseInt(bareMinuteMatch[1] ?? "", 10) : 0
  if (bareMinutes > 0) {
    return bareMinutes * 60
  }

  const pattern =
    /(\d+)\s*(h|hr|hrs|hour|hours|小时|小時|m|min|mins|minute|minutes|分钟|分鐘|分|s|sec|secs|second|seconds|秒)(?=\s|\d|$)/gi
  let total = 0
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0
    if (text.slice(cursor, matchIndex).trim()) {
      throw new Error("Use a duration like 1h, 30m, or 45s.")
    }

    const amount = Number.parseInt(match[1] ?? "", 10)
    const unit = (match[2] ?? "").toLowerCase()
    if (!Number.isFinite(amount)) {
      continue
    }
    if (unit.startsWith("h") || unit === "小时" || unit === "小時") {
      total += amount * 3_600
    } else if (unit.startsWith("m") || unit === "分钟" || unit === "分鐘" || unit === "分") {
      total += amount * 60
    } else {
      total += amount
    }
    cursor = matchIndex + match[0].length
  }

  if (text.slice(cursor).trim() || total <= 0) {
    throw new Error("Use a duration like 1h, 30m, or 45s.")
  }

  return total
}

export function parseCoffeeUntil(input: string): { durationSeconds: number; label: string } {
  const pattern = /^(\d{1,2})(?::(\d\d))? *(am|pm)?$/i
  const match = pattern.exec(input.trim())
  if (!match) {
    throw new Error("Use a time like 17:30, 5pm, or 8:15am.")
  }

  const inputHour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const ampm = match[3]?.toLowerCase()
  if (ampm && (inputHour < 1 || inputHour > 12)) {
    throw new Error("Use a valid time.")
  }

  let hour = inputHour
  if (ampm === "pm" && inputHour < 12) {
    hour += 12
  }
  if (ampm === "am" && inputHour === 12) {
    hour = 0
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Use a valid time.")
  }

  const now = new Date()
  const target = new Date()
  target.setHours(hour, minute, 0, 0)

  const isExplicit24Hour = Boolean(ampm) || hour > 12 || (match[1] ?? "").startsWith("0")
  while (target <= now) {
    target.setHours(target.getHours() + (isExplicit24Hour ? 24 : 12))
  }

  const durationSeconds = Math.ceil((target.getTime() - now.getTime()) / 1000)
  const tomorrow = target.getDate() !== now.getDate() ? "tomorrow at " : ""
  return {
    durationSeconds,
    label: `${tomorrow}${target.toLocaleTimeString([], { timeStyle: "short" })}`
  }
}

function readWholeNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("Duration arguments must be whole numbers.")
    }

    return value
  }

  const text = String(value).trim()
  if (!text) {
    return 0
  }
  if (!/^\d+$/.test(text)) {
    throw new Error("Duration arguments must be whole numbers.")
  }

  const numberValue = Number.parseInt(text, 10)
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error("Duration arguments must be whole numbers.")
  }

  return numberValue
}
