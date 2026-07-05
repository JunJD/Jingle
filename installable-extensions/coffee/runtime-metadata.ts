import { defineNativeExtensionRuntimeMetadata } from "@jingle/extension-api"

const COFFEE_SUBJECT_TERMS = [
  "coffee",
  "caffeinate",
  "awake",
  "sleep",
  "mac awake",
  "防睡眠",
  "唤醒",
  "保持唤醒"
]

export const coffeeRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: "caffeinate",
      search: {
        aliases: ["coffee", "caffeinate", "keep awake", "stay awake", "保持唤醒"],
        keywords: COFFEE_SUBJECT_TERMS
      }
    },
    {
      name: "decaffeinate",
      search: {
        aliases: ["decaffeinate", "stop coffee", "allow sleep", "停止保持唤醒"],
        keywords: [...COFFEE_SUBJECT_TERMS, "stop", "停止", "睡眠"]
      }
    },
    {
      name: "caffeinateToggle",
      search: {
        aliases: ["toggle coffee", "toggle caffeinate", "切换保持唤醒"],
        keywords: [...COFFEE_SUBJECT_TERMS, "toggle", "切换"]
      }
    },
    {
      name: "caffeinateFor",
      search: {
        aliases: ["coffee for", "caffeinate for", "keep awake for", "保持唤醒一段时间"],
        argumentHints: [
          {
            aliases: ["duration", "time", "时长"],
            name: "duration"
          }
        ],
        keywords: [...COFFEE_SUBJECT_TERMS, "duration", "timer", "一段时间", "时长"]
      }
    },
    {
      name: "caffeinateUntil",
      search: {
        aliases: ["coffee until", "caffeinate until", "keep awake until", "保持唤醒直到"],
        argumentHints: [
          {
            aliases: ["time", "until", "时间"],
            name: "time"
          }
        ],
        keywords: [...COFFEE_SUBJECT_TERMS, "until", "time", "直到", "时间"]
      }
    },
    {
      name: "status",
      search: {
        aliases: ["coffee status", "caffeinate status", "唤醒状态"],
        keywords: [...COFFEE_SUBJECT_TERMS, "status", "状态"]
      }
    }
  ],
  extensionName: "coffee"
})
