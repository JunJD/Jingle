import { defineNativeExtensionManifest } from "@openwork/extension-api"
import { viewport as indexViewport } from "./src/index.meta"
import { EXTENSION_ID, EXTENSION_PROVIDER_ID, EXTENSION_TITLE } from "./identity"

export const figmaFilesManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
  commands: [
    {
      arguments: [],
      description: "Browse and search Figma team files.",
      keywords: ["figma", "files", "search", "team", "design"],
      mode: "view",
      name: "index",
      preferences: [],
      runtime: {
        viewport: indexViewport
      },
      title: "Search Files"
    },
    {
      arguments: [],
      description: "Quick access to starred, recent, and team files from the menu bar.",
      mode: "menu-bar",
      name: "menu-bar",
      preferences: [],
      runtime: {},
      title: "Quicklook"
    }
  ],
  connection: {
    auth: {
      secretNames: ["accessToken"],
      type: "personalAccessToken"
    },
    id: "default",
    provider: EXTENSION_PROVIDER_ID,
    publicPreferenceNames: ["TEAM_ID", "open_in"],
    title: EXTENSION_TITLE
  },
  description: "Search Figma team files and open pages or branches from Openwork.",
  icon: "assets/command-icon.png",
  name: EXTENSION_ID,
  preferences: [
    {
      description: "Personal access token used to read your Figma teams and files.",
      name: "accessToken",
      placeholder: "figd_...",
      required: false,
      title: "Figma Personal Access Token",
      type: "password"
    },
    {
      description:
        "One or more Figma team IDs separated by commas. Find a team ID in the Figma team URL.",
      name: "TEAM_ID",
      placeholder: "1234567890, 0987654321",
      required: true,
      title: "Team IDs",
      type: "text"
    },
    {
      default: {
        bundleId: "com.figma.Desktop",
        name: "Figma"
      },
      description: "Choose where files open from runtime commands.",
      name: "open_in",
      placeholder: "Figma",
      required: false,
      title: "Open File In",
      type: "appPicker"
    }
  ],
  runtimeCapabilities: ["clipboard", "navigation", "preferences", "settings", "shell", "storage", "toast"],
  runtimeShell: {
    allowedUrlSchemes: ["figma"]
  },
  supportedPlatforms: ["darwin", "win32"],
  title: EXTENSION_TITLE
})
