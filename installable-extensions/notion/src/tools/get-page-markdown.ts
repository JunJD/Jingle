import { withAccessToken } from "@openwork/extension-utils";

import { getPageMarkdown } from "../../domain";
import { notionConnection } from "../../domain/client";

type Input = {
  /** The ID of the Notion page to fetch */
  pageId: string;
};

export default withAccessToken(notionConnection)(async ({ pageId }: Input) => {
  try {
    return await getPageMarkdown(pageId);
  } catch (err) {
    return {
      status: "error",
      markdown: err instanceof Error ? err.message : JSON.stringify(err),
    };
  }
});
