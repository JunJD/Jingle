import React from "react"
void React
import { Action, getPreferenceValues } from "@jingle/extension-api";

import { getPageName, Page } from "../../../domain";
import { urlForPreferredMethod } from "../../utils/openPage";

export default function ActionCreateQuicklink({ page }: { page: Page }) {
  if (!page.url) return null;
  const open_in = getPreferenceValues<Preferences>().open_in;
  const link = urlForPreferredMethod(page.url, open_in);

  return (
    <Action.CreateQuicklink
      shortcut={{
        macOS: { modifiers: ["cmd"], key: "l" },
        Windows: { modifiers: ["ctrl"], key: "l" },
      }}
      quicklink={{
        link,
        name: getPageName(page),
      }}
    />
  );
}
