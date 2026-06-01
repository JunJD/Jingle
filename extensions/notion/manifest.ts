import { defineNativeExtensionManifest } from "@openwork/extension-api"
import { viewport as createDatabasePageViewport } from "./src/create-database-page.meta"
import { viewport as searchPageViewport } from "./src/search-page.meta"
import { viewport as quickCaptureViewport } from "./src/quick-capture.meta"
import { viewport as addTextToPageViewport } from "./src/add-text-to-page.meta"
import {
  NOTION_COMMAND_NAMES,
  NOTION_EXTENSION_ID,
  NOTION_EXTENSION_TITLE,
  NOTION_PROVIDER_ID
} from "./identity"

export const notionManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    description: "Notion workspace pages, data sources, tasks, and docs.",
    guide:
      "Use this capability for Notion work only after the user connects Notion. Notion only returns pages and data sources shared with the connected integration. If auth status is missing, explain that Notion needs an integration token in Settings before you can inspect pages, data sources, tasks, docs, or workspace knowledge.",
    id: NOTION_EXTENSION_ID,
    instructions: [
      "Use Notion only when the user's request is about Notion pages, data sources, tasks, docs, or workspace knowledge.",
      "If Notion is not connected, explain that Notion needs an integration token in Settings before you can inspect Notion content.",
      "Search Notion before retrieving a page or data source unless the user provided an exact page, block, or data source id.",
      "Notion API access is limited to pages and data sources shared with the connected integration.",
      "Adding content to a Notion page writes to Notion and must follow the current Permission Mode.",
      "Do not claim to have searched Notion unless a Notion tool was available and called."
    ],
    publicPreferenceNames: ["apiBaseUrl"],
    requiredPreferenceNames: ["accessToken"],
    mention: {
      label: NOTION_EXTENSION_TITLE,
      value: NOTION_EXTENSION_ID
    },
    title: NOTION_EXTENSION_TITLE,
    toolDisplays: {
      searchPages: {
        description: "Search Notion pages or data sources shared with the connected integration.",
        title: "Search Pages"
      },
      getPage: {
        description: "Get the Markdown content of a Notion page.",
        title: "Get Page"
      },
      retrievePage: {
        description: "Retrieve a Notion page's metadata and properties.",
        title: "Retrieve Page"
      },
      getPageMarkdown: {
        description: "Retrieve a Notion page's child blocks as Markdown.",
        title: "Get Page Markdown"
      },
      listBlockChildren: {
        description: "Retrieve child blocks for a Notion page or block.",
        title: "List Block Children"
      },
      addToPage: {
        description: "Append Markdown content to a Notion page.",
        title: "Add to Page"
      },
      createPage: {
        description: "Create a Notion page in a data source.",
        title: "Create Page"
      },
      getDatabases: {
        description: "List Notion data sources shared with the connected integration.",
        title: "Get Databases"
      },
      retrieveDataSource: {
        description: "Retrieve a Notion data source schema shared with the connected integration.",
        title: "Retrieve Data Source"
      },
      searchDatabase: {
        description: "Search pages in a Notion data source shared with the connected integration.",
        title: "Search Database"
      },
      queryDataSource: {
        description: "Query a Notion data source shared with the connected integration.",
        title: "Query Data Source"
      },
      createDatabasePage: {
        description: "Create a Notion page in a data source.",
        title: "Create Database Page"
      }
    },
    toolNames: [
      "searchPages",
      "getPage",
      "retrievePage",
      "getPageMarkdown",
      "listBlockChildren",
      "getDatabases",
      "retrieveDataSource",
      "searchDatabase",
      "queryDataSource",
      "addToPage",
      "createPage",
      "createDatabasePage"
    ]
  },
  capabilities: ["navigation", "surface"],
  commands: [
    {
      arguments: [
        {
          name: "text",
          type: "text",
          title: "Text",
          placeholder: "Markdown content",
          required: false
        }
      ],
      description:
        "Append Markdown content to a Notion page shared with the connected integration.",
      keywords: ["notion", "append", "add", "markdown", "page"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.addTextToPage,
      preferences: [],
      runtime: {
        viewport: addTextToPageViewport
      },
      title: "Add Text to Page"
    },
    {
      arguments: [],
      description: "Create a Notion page in a data source shared with the connected integration.",
      keywords: ["notion", "create", "database", "data source", "page", "markdown"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.createDatabasePage,
      preferences: [
        {
          name: "closeAfterCreate",
          type: "checkbox",
          label: "Close Openwork after creating the page",
          required: false,
          default: false,
          title: "Close After Create",
          description: "Hide Openwork after creating the page."
        },
        {
          name: "useClipboard",
          type: "dropdown",
          title: "Use Clipboard to Autofill",
          required: false,
          data: [
            {
              title: "Don't use Clipboard",
              value: ""
            },
            {
              title: "Title",
              value: "title"
            },
            {
              title: "Content",
              value: "content"
            }
          ],
          default: "",
          description: "Use the current clipboard text to prefill title or content."
        }
      ],
      runtime: {
        viewport: createDatabasePageViewport
      },
      title: "Create Page"
    },
    {
      arguments: [],
      description: "Capture a web URL into a Notion page or data source.",
      keywords: ["notion", "quick", "capture", "url", "web", "summary"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.quickCapture,
      preferences: [],
      runtime: {
        viewport: quickCaptureViewport
      },
      title: "Quick Capture"
    },
    {
      arguments: [],
      description: "Search Notion pages and data sources shared with the connected integration.",
      keywords: ["notion", "page", "search", "docs", "database"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.searchPage,
      preferences: [
        {
          name: "primaryAction",
          type: "dropdown",
          title: "Primary Action",
          required: false,
          default: "notion",
          data: [
            {
              title: "Open in Notion",
              value: "notion"
            },
            {
              title: "Preview in Openwork",
              value: "openwork"
            }
          ],
          description: "Choose the primary action for Notion page results."
        }
      ],
      runtime: {
        viewport: searchPageViewport
      },
      title: "Search Pages"
    }
  ],
  connection: {
    auth: {
      secretNames: ["accessToken"],
      type: "apiKey"
    },
    id: "default",
    provider: NOTION_PROVIDER_ID,
    connectGuide:
      "Create a Notion internal integration token, share pages or data sources with that integration, and save the token in Openwork Settings.",
    publicPreferenceNames: ["apiBaseUrl"],
    title: NOTION_EXTENSION_TITLE
  },
  description: "The fastest way to search, create and update Notion pages.",
  icon: "assets/notion-logo.png",
  iconName: "notion",
  name: NOTION_EXTENSION_ID,
  preferences: [
    {
      name: "accessToken",
      type: "password",
      title: "Notion Integration Token",
      required: false,
      description:
        "Internal integration token used to read Notion content shared with the integration.",
      placeholder: "secret_..."
    },
    {
      name: "apiBaseUrl",
      type: "text",
      title: "Notion API Base URL",
      required: false,
      default: "https://api.notion.com/v1",
      description: "Override this only if you proxy the Notion API.",
      placeholder: "https://api.notion.com/v1"
    },
    {
      name: "open_in",
      type: "appPicker",
      title: "Open Page In",
      required: false,
      default: {
        name: "Notion"
      },
      description: "Choose where Notion pages open from runtime commands.",
      placeholder: "Notion"
    },
    {
      name: "properties_in_page_previews",
      type: "checkbox",
      title: "Properties in Page Previews",
      required: false,
      default: false,
      description: "Show known Notion page properties above page previews.",
      label: "Show properties in page previews."
    }
  ],
  runtimeCapabilities: [
    "ai",
    "clipboard",
    "dialog",
    "navigation",
    "preferences",
    "quicklinks",
    "settings",
    "shell",
    "storage",
    "toast"
  ],
  runtimeShell: {
    allowedUrlSchemes: ["notion"]
  },
  title: NOTION_EXTENSION_TITLE
})
