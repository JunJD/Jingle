import { withAccessToken } from "@openwork/extension-utils";

import { getPageContent } from "../../domain";
import { notionConnection } from "../../domain/client";

type Input = {
  /** The ID of the Notion page to fetch */
  pageId: string;
};

export default withAccessToken(notionConnection)(async ({ pageId }: Input) => {
  try {
    return await getPageContent(pageId);
  } catch (err) {
    return {
      status: "error",
      content: err instanceof Error ? err.message : JSON.stringify(err),
    };
  }
});
