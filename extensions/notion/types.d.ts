import type { RuntimeOpenApplication } from "@openwork/extension-api"

// Compatibility ambient types that Openwork injects for migrated extensions.
declare global {
  type Preferences = Preferences.Extension

  namespace Preferences {
    type Extension = {
      accessToken?: string
      apiBaseUrl?: string
      open_in?: RuntimeOpenApplication
      properties_in_page_previews?: boolean
      notion_token?: string
    }
    type CreateDatabasePage = Extension & {
      closeAfterCreate?: boolean
      useClipboard?: string
    }
    type SearchPage = Extension & {
      primaryAction?: string
    }
  }

  namespace Arguments {
    type AddTextToPage = {
      text?: string
    }
  }
}

export {}
