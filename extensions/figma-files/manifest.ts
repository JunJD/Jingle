import { defineLocalizedText as l, defineNativeExtensionManifest } from "@openwork/extension-api"
import { viewport as indexViewport } from "./src/index.meta"
import { EXTENSION_ID, EXTENSION_PROVIDER_ID, EXTENSION_TITLE } from "./identity"

export const figmaFilesManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
  commands: [
    {
      arguments: [],
      description: l("Browse and search Figma team files.", "浏览并搜索 Figma 团队文件。"),
      keywords: ["figma", "files", "search", "team", "design"],
      mode: "view",
      name: "index",
      preferences: [],
      runtime: {
        viewport: indexViewport
      },
      title: l("Search Files", "搜索文件")
    },
    {
      arguments: [],
      description: l(
        "Quick access to starred, recent, and team files from the menu bar.",
        "从菜单栏快速访问加星、最近和团队文件。"
      ),
      mode: "menu-bar",
      name: "menu-bar",
      preferences: [],
      runtime: {},
      title: l("Quicklook", "快速查看")
    }
  ],
  connection: {
    auth: {
      authorizationUrl: "https://jingle.cool/oauth/figma/start",
      clientId: "jingle-desktop",
      redirect: {
        callbackPath: "/oauth/callback",
        method: "app-scheme",
        scheme: "jingle"
      },
      scopes: ["current_user:read", "projects:read", "file_metadata:read", "file_content:read"],
      secretNames: ["accessToken"],
      tokenUrl: "https://jingle.cool/oauth/figma/token",
      type: "oauth"
    },
    connectGuide:
      "Connect Figma from Jingle Settings. Jingle opens jingle.cool for authorization and stores the returned Figma access token locally.",
    id: "default",
    provider: EXTENSION_PROVIDER_ID,
    publicPreferenceNames: ["TEAM_ID", "open_in"],
    title: l(EXTENSION_TITLE, "Figma 文件搜索")
  },
  description: l(
    "Search Figma team files and open pages or branches from Openwork.",
    "在 Openwork 中搜索 Figma 团队文件并打开页面或分支。"
  ),
  icon: "assets/command-icon.png",
  name: EXTENSION_ID,
  preferences: [
    {
      description: l(
        "One or more Figma team IDs separated by commas. Find a team ID in the Figma team URL.",
        "填写一个或多个 Figma 团队 ID，用英文逗号分隔。团队 ID 可在 Figma 团队页面 URL 中找到。"
      ),
      name: "TEAM_ID",
      placeholder: "1234567890, 0987654321",
      required: true,
      title: l("Team IDs", "团队 ID"),
      type: "text"
    },
    {
      default: {
        bundleId: "com.figma.Desktop",
        name: "Figma"
      },
      description: l(
        "Choose where files open from runtime commands.",
        "选择 runtime 命令打开文件时使用的应用。"
      ),
      name: "open_in",
      placeholder: l("Figma", "Figma"),
      required: false,
      title: l("Open File In", "文件打开位置"),
      type: "appPicker"
    }
  ],
  runtimeCapabilities: ["clipboard", "navigation", "preferences", "settings", "shell", "storage", "toast"],
  runtimeShell: {
    allowedUrlSchemes: ["figma"]
  },
  supportedPlatforms: ["darwin", "win32"],
  title: l(EXTENSION_TITLE, "Figma 文件搜索")
})
