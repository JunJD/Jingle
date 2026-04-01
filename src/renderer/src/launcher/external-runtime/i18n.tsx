// @ts-nocheck
export function useI18n(): { t: (key: string) => string } {
  return {
    t: (key: string) => {
      switch (key) {
        case "common.loading":
          return "Loading"
        case "common.noResults":
          return "No results"
        default:
          return key.split(".").pop() ?? key
      }
    }
  }
}
