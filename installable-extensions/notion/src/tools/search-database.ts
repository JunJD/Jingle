import { withAccessToken } from "@openwork/extension-utils";

import { queryDatabase } from "../../domain/database";
import { notionConnection } from "../../domain/client";

type Input = {
  /** The ID of the database to search. */
  databaseId: string;
  /** The query to search for. Only use plain text: it doesn't support any operators */
  query: string;
};

export default withAccessToken(notionConnection)(async ({ databaseId, query }: Input) => {
  const result = await queryDatabase(databaseId, query);
  return result;
});
