import { defineNativeExtensionManifest } from "@shared/native-extensions"

export const notionManifest = defineNativeExtensionManifest({
  aiCapability: {
    description: "Notion workspace pages, databases, tasks, and docs.",
    guide:
      "Use this capability for Notion work only after the user connects Notion. If auth status is missing, explain that Notion needs to be connected before you can inspect pages, databases, tasks, docs, or workspace knowledge.",
    id: "notion",
    instructions: [
      "Use Notion only when the user's request is about Notion pages, databases, tasks, docs, or workspace knowledge.",
      "If Notion is not connected, explain that Notion needs to be connected before you can inspect or modify Notion content.",
      "Do not claim to have searched Notion unless a Notion tool was available and called."
    ],
    mention: {
      label: "Notion",
      value: "notion"
    },
    requiredPreferenceNames: ["accessToken"],
    title: "Notion",
    toolNames: []
  },
  capabilities: [],
  commands: [],
  description: "Use Notion with Openwork AI after connecting your workspace.",
  iconName: "notion",
  name: "notion",
  title: "Notion"
})
