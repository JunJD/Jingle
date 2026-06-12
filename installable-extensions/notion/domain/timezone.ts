export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
