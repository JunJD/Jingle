import { defineNativeExtensionManifest } from "@shared/native-extensions"

export const notionManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    description: "Notion workspace pages, data sources, tasks, and docs.",
    guide:
      "Use this capability for Notion work only after the user connects Notion. Notion only returns pages and data sources shared with the connected integration. If auth status is missing, explain that Notion needs an integration token in Settings before you can inspect pages, data sources, tasks, docs, or workspace knowledge.",
    id: "notion",
    instructions: [
      "Use Notion only when the user's request is about Notion pages, data sources, tasks, docs, or workspace knowledge.",
      "If Notion is not connected, explain that Notion needs an integration token in Settings before you can inspect Notion content.",
      "Search Notion before retrieving a page or data source unless the user provided an exact page, block, or data source id.",
      "Notion API access is limited to pages and data sources shared with the connected integration.",
      "Do not claim to have searched Notion unless a Notion tool was available and called."
    ],
    mention: {
      label: "Notion",
      value: "notion"
    },
    publicPreferenceNames: ["apiBaseUrl"],
    requiredPreferenceNames: ["accessToken"],
    title: "Notion",
    toolDisplays: {
      listBlockChildren: {
        description: "Retrieve child blocks for a Notion page or block.",
        title: "List Block Children"
      },
      retrievePage: {
        description: "Retrieve a Notion page's metadata and properties.",
        title: "Retrieve Page"
      },
      retrieveDataSource: {
        description: "Retrieve a Notion data source schema shared with the connected integration.",
        title: "Retrieve Data Source"
      },
      queryDataSource: {
        description: "Query a Notion data source shared with the connected integration.",
        title: "Query Data Source"
      },
      searchPages: {
        description: "Search Notion pages or data sources shared with the connected integration.",
        title: "Search Pages"
      }
    },
    toolNames: [
      "searchPages",
      "retrievePage",
      "listBlockChildren",
      "retrieveDataSource",
      "queryDataSource"
    ]
  },
  capabilities: [],
  commands: [],
  connection: {
    auth: {
      secretNames: ["accessToken"],
      type: "apiKey"
    },
    connectGuide:
      "Create a Notion internal integration token, share pages or data sources with that integration, and save the token in Openwork Settings.",
    id: "default",
    provider: "notion",
    publicPreferenceNames: ["apiBaseUrl"],
    title: "Notion"
  },
  description: "Use Notion with Openwork AI after connecting your workspace.",
  iconName: "notion",
  preferences: [
    {
      description:
        "Internal integration token used to read Notion content shared with the integration.",
      name: "accessToken",
      placeholder: "secret_...",
      title: "Notion Integration Token",
      type: "password"
    },
    {
      default: "https://api.notion.com/v1",
      description: "Override this only if you proxy the Notion API.",
      name: "apiBaseUrl",
      placeholder: "https://api.notion.com/v1",
      title: "Notion API Base URL",
      type: "text"
    }
  ],
  name: "notion",
  title: "Notion"
})
