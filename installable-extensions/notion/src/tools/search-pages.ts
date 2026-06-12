import { withAccessToken } from "@openwork/extension-utils";

import { search, Page } from "../../domain";
import { notionConnection } from "../../domain/client";

type cleanedPage = Pick<Page, "id" | "title" | "url" | "parent_database_id" | "parent_page_id">;

type Input = {
  /** The title of the page to search for. Only use plain text: it doesn't support any operators */
  searchText: string;
};

export default withAccessToken(notionConnection)(async ({ searchText }: Input) => {
  const allPages: cleanedPage[] = [];
  let hasNextPage = true;
  let cursor: string | undefined = undefined;
  const pageSize = 100;

  while (hasNextPage && allPages.length < 250) {
    const result = await search(searchText, cursor, pageSize);
    allPages.push(
      ...result.pages.map((page) => ({
        id: page.id,
        title: page.title,
        url: page.url,
        parent_database_id: page.parent_database_id,
        parent_page_id: page.parent_page_id,
      })),
    );
    hasNextPage = result.hasMore;
    cursor = result.nextCursor ?? undefined;
  }

  return allPages;
});
