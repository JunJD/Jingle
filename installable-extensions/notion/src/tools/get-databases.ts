import { withAccessToken } from "@openwork/extension-utils";

import { fetchDatabases } from "../../domain/database";
import { notionConnection } from "../../domain/client";

export default withAccessToken(notionConnection)(async () => {
  const databases = await fetchDatabases();
  return databases;
});
