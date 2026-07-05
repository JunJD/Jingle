import { Client } from "@notionhq/client";
import { getConnectionSecret, getPreferenceValues } from "@jingle/extension-api";
import type { WithAccessTokenService } from "@jingle/extension-utils";

const DEFAULT_NOTION_API_BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

export const notionConnection: WithAccessTokenService = {
  async authorize() {
    return getNotionAccessToken();
  },
  async getAccessToken() {
    return getNotionAccessToken();
  },
};

export function getNotionAccessToken(): string {
  const accessToken = getConnectionSecret("accessToken");
  if (!accessToken) {
    throw new Error("Connect Notion in Settings before using this extension.");
  }

  return accessToken;
}

export function getNotionClient() {
  const preferences = getPreferenceValues<Preferences.Extension>();
  return new Client({
    auth: getNotionAccessToken(),
    baseUrl: normalizeNotionClientBaseUrl(preferences.apiBaseUrl),
    notionVersion: NOTION_VERSION,
    retry: false,
  });
}

function normalizeNotionClientBaseUrl(apiBaseUrl: string | undefined): string {
  const normalized = String(apiBaseUrl ?? DEFAULT_NOTION_API_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

  return (normalized || DEFAULT_NOTION_API_BASE_URL).replace(/\/v1$/i, "");
}
