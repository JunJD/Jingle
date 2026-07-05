import { iteratePaginatedAPI, type UserObjectResponse } from "@notionhq/client";

import { handleError } from "./global";
import { getNotionClient } from "./client";

export async function fetchUsers() {
  try {
    const notion = getNotionClient();
    const users: UserObjectResponse[] = [];
    for await (const user of iteratePaginatedAPI(notion.users.list, {}) as AsyncIterable<UserObjectResponse>) {
      users.push(user);
    }
    const mappedUsers: User[] = [];
    for (const user of users) {
      if (user.object !== "user" || user.type !== "person") continue;
      mappedUsers.push({
        id: user.id,
        name: user.name,
        type: user.type,
        avatar_url: user.avatar_url,
      });
    }
    return mappedUsers;
  } catch (err) {
    return handleError(err, "Failed to fetch users", []);
  }
}
export interface User {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
}
