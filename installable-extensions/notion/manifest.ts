import { defineLocalizedText as l, defineNativeExtensionManifest } from "@openwork/extension-api"
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
      "Use this capability for Notion work only after the user connects Notion. Notion only returns pages and data sources shared with the connected connection. If auth status is missing, explain that Notion needs to be connected in Settings before you can inspect pages, data sources, tasks, docs, or workspace knowledge.",
    id: NOTION_EXTENSION_ID,
    instructions: [
      "Use Notion only when the user's request is about Notion pages, data sources, tasks, docs, or workspace knowledge.",
      "If Notion is not connected, explain that Notion needs to be connected in Settings before you can inspect Notion content.",
      "Search Notion before retrieving a page or data source unless the user provided an exact page, block, or data source id.",
      "Notion API access is limited to pages and data sources shared with the connected connection.",
      "Adding content to a Notion page writes to Notion and must follow the current Permission Mode.",
      "Do not claim to have searched Notion unless a Notion tool was available and called."
    ],
    mention: {
      label: l(NOTION_EXTENSION_TITLE, "Notion"),
      value: NOTION_EXTENSION_ID
    },
    title: l(NOTION_EXTENSION_TITLE, "Notion"),
    toolDisplays: {
      searchPages: {
        description: l(
          "Search Notion pages or data sources shared with the connected integration.",
          "搜索已授权集成共享的 Notion 页面或数据源。"
        ),
        title: l("Search Pages", "搜索页面")
      },
      getPage: {
        description: l(
          "Get the Markdown content of a Notion page.",
          "获取 Notion 页面的 Markdown 内容。"
        ),
        title: l("Get Page", "获取页面")
      },
      retrievePage: {
        description: l(
          "Retrieve a Notion page's metadata and properties.",
          "获取 Notion 页面的元数据和属性。"
        ),
        title: l("Retrieve Page", "获取页面详情")
      },
      getPageMarkdown: {
        description: l(
          "Retrieve a Notion page's child blocks as Markdown.",
          "将 Notion 页面的子块获取为 Markdown。"
        ),
        title: l("Get Page Markdown", "获取页面 Markdown")
      },
      listBlockChildren: {
        description: l(
          "Retrieve child blocks for a Notion page or block.",
          "获取 Notion 页面或块的子块。"
        ),
        title: l("List Block Children", "列出子块")
      },
      addToPage: {
        description: l(
          "Append Markdown content to a Notion page.",
          "向 Notion 页面追加 Markdown 内容。"
        ),
        title: l("Add to Page", "追加到页面")
      },
      getDatabases: {
        description: l(
          "List Notion data sources shared with the connected integration.",
          "列出已授权集成共享的 Notion 数据源。"
        ),
        title: l("Get Databases", "获取数据源")
      },
      retrieveDataSource: {
        description: l(
          "Retrieve a Notion data source schema shared with the connected integration.",
          "获取已授权集成共享的 Notion 数据源结构。"
        ),
        title: l("Retrieve Data Source", "获取数据源详情")
      },
      queryDataSource: {
        description: l(
          "Query a Notion data source shared with the connected integration.",
          "查询已授权集成共享的 Notion 数据源。"
        ),
        title: l("Query Data Source", "查询数据源")
      },
      createDatabasePage: {
        description: l("Create a Notion page in a data source.", "在数据源中创建 Notion 页面。"),
        title: l("Create Database Page", "创建数据库页面")
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
      "queryDataSource",
      "addToPage",
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
          title: l("Text", "文本"),
          placeholder: l("Markdown content", "Markdown 内容"),
          required: false
        }
      ],
      description: l(
        "Append Markdown content to a Notion page shared with the connected integration.",
        "向已授权集成共享的 Notion 页面追加 Markdown 内容。"
      ),
      keywords: ["notion", "append", "add", "markdown", "page"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.addTextToPage,
      preferences: [],
      runtime: {
        viewport: addTextToPageViewport
      },
      title: l("Add Text to Page", "向页面添加文本")
    },
    {
      arguments: [],
      description: l(
        "Create a Notion page in a data source shared with the connected integration.",
        "在已授权集成共享的数据源中创建 Notion 页面。"
      ),
      keywords: ["notion", "create", "database", "data source", "page", "markdown"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.createDatabasePage,
      preferences: [
        {
          name: "closeAfterCreate",
          type: "checkbox",
          label: l("Close Openwork after creating the page", "创建页面后关闭 Openwork"),
          required: false,
          default: false,
          title: l("Close After Create", "创建后关闭"),
          description: l("Hide Openwork after creating the page.", "创建页面后隐藏 Openwork。")
        },
        {
          name: "useClipboard",
          type: "dropdown",
          title: l("Use Clipboard to Autofill", "使用剪贴板自动填充"),
          required: false,
          data: [
            {
              title: l("Don't use Clipboard", "不使用剪贴板"),
              value: ""
            },
            {
              title: l("Title", "标题"),
              value: "title"
            },
            {
              title: l("Content", "内容"),
              value: "content"
            }
          ],
          default: "",
          description: l(
            "Use the current clipboard text to prefill title or content.",
            "使用当前剪贴板文本预填标题或内容。"
          )
        }
      ],
      runtime: {
        viewport: createDatabasePageViewport
      },
      title: l("Create Page", "创建页面")
    },
    {
      arguments: [],
      description: l(
        "Capture a web URL into a Notion page or data source.",
        "把网页 URL 捕捉到 Notion 页面或数据源。"
      ),
      keywords: ["notion", "quick", "capture", "url", "web", "summary"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.quickCapture,
      preferences: [],
      runtime: {
        viewport: quickCaptureViewport
      },
      title: l("Quick Capture", "快速捕捉")
    },
    {
      arguments: [],
      description: l(
        "Search Notion pages and data sources shared with the connected integration.",
        "搜索已授权集成共享的 Notion 页面和数据源。"
      ),
      keywords: ["notion", "page", "search", "docs", "database"],
      mode: "view",
      name: NOTION_COMMAND_NAMES.searchPage,
      preferences: [
        {
          name: "primaryAction",
          type: "dropdown",
          title: l("Primary Action", "主要操作"),
          required: false,
          default: "notion",
          data: [
            {
              title: l("Open in Notion", "在 Notion 中打开"),
              value: "notion"
            },
            {
              title: l("Preview in Openwork", "在 Openwork 中预览"),
              value: "openwork"
            }
          ],
          description: l(
            "Choose the primary action for Notion page results.",
            "选择 Notion 页面结果的主要操作。"
          )
        }
      ],
      runtime: {
        viewport: searchPageViewport
      },
      title: l("Search Pages", "搜索页面")
    }
  ],
  connection: {
    auth: {
      authorizationUrl: "https://jingle.cool/oauth/notion/start",
      clientId: "jingle-desktop",
      redirect: {
        callbackPath: "/oauth/callback",
        method: "app-scheme",
        scheme: "jingle"
      },
      scopes: [],
      secretNames: ["accessToken"],
      tokenUrl: "https://jingle.cool/oauth/notion/token",
      type: "oauth"
    },
    id: "default",
    provider: NOTION_PROVIDER_ID,
    connectGuide:
      "Connect Notion from Jingle Settings. Jingle opens jingle.cool for authorization and stores the returned Notion access token locally.",
    publicPreferenceNames: ["apiBaseUrl"],
    title: l(NOTION_EXTENSION_TITLE, "Notion")
  },
  description: l(
    "The fastest way to search, create and update Notion pages.",
    "快速搜索、创建和更新 Notion 页面。"
  ),
  icon: "assets/notion-logo.png",
  iconName: "notion",
  name: NOTION_EXTENSION_ID,
  preferences: [
    {
      name: "apiBaseUrl",
      type: "text",
      title: l("Notion API Base URL", "Notion API 基础 URL"),
      required: false,
      default: "https://api.notion.com/v1",
      description: l(
        "Override this only if you proxy the Notion API.",
        "仅在代理 Notion API 时覆盖此项。"
      ),
      placeholder: "https://api.notion.com/v1"
    },
    {
      name: "open_in",
      type: "appPicker",
      title: l("Open Page In", "页面打开位置"),
      required: false,
      default: {
        name: "Notion"
      },
      description: l(
        "Choose where Notion pages open from runtime commands.",
        "选择 runtime 命令打开 Notion 页面的应用。"
      ),
      placeholder: l("Notion", "Notion")
    },
    {
      name: "properties_in_page_previews",
      type: "checkbox",
      title: l("Properties in Page Previews", "页面预览显示属性"),
      required: false,
      default: false,
      description: l(
        "Show known Notion page properties above page previews.",
        "在页面预览上方显示已知 Notion 页面属性。"
      ),
      label: l("Show properties in page previews.", "在页面预览中显示属性。")
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
  title: l(NOTION_EXTENSION_TITLE, "Notion")
})
