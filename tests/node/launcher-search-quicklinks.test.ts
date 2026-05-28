import assert from "node:assert/strict"
import test from "node:test"
import {
  configureQuicklinksLauncherSearchProvider,
  quicklinksLauncherSearchProvider
} from "../../src/main/services/launcher-search/providers/quicklinks"

test("quicklink launcher search opens registered extension command quicklinks with launch context", async () => {
  configureQuicklinksLauncherSearchProvider({
    listQuicklinks: () => [
      {
        createdAt: "2026-05-27T00:00:00.000Z",
        extensionName: "notion-generated",
        id: "quicklink-notion-create-page",
        link: "openwork://extensions/notion-generated/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
        name: "Create generated Notion page",
        updatedAt: "2026-05-27T00:00:00.000Z"
      }
    ]
  })

  const response = await quicklinksLauncherSearchProvider.search({
    limit: 5,
    query: "generated",
    sources: ["quicklinks"]
  })

  assert.equal(response.results.length, 1)
  assert.deepEqual(response.results[0], {
    action: {
      executor: "internal",
      target: {
        commandName: "create-database-page",
        extensionName: "notion-generated",
        launchProps: {
          launchContext: {
            defaults: {
              title: "Spec"
            }
          }
        }
      },
      type: "open-extension-command"
    },
    id: "quicklink-notion-create-page",
    kind: "url",
    score: 650,
    source: "quicklinks",
    subtitle:
      "notion-generated · openwork://extensions/notion-generated/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
    title: "Create generated Notion page"
  })
})
