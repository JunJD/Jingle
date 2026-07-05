import test from "node:test"
import assert from "node:assert/strict"
import { createJingleWebToolsMiddleware } from "@jingle/langchain-agent-harness/transitional"
import {
  assertSafePublicHttpUrl,
  normalizePublicHttpUrl
} from "../../src/main/services/web-tools/url-guard"

test("jingle web tools middleware owns web_search shell and delegates query", async () => {
  const queries: string[] = []
  const middleware = createJingleWebToolsMiddleware({
    searchWeb: async (query) => {
      queries.push(query)
      return { query, results: [] }
    }
  })

  assert.equal(middleware.name, "jingleWebTools")
  assert.equal(middleware.tools?.[0]?.name, "web_search")

  await middleware.tools?.[0]?.invoke({ query: "  LangChain middleware docs  " })
  await assert.rejects(() => middleware.tools![0]!.invoke({ query: "   " }), /web_search/)
  assert.deepEqual(queries, ["LangChain middleware docs"])
})

test("normalizePublicHttpUrl keeps valid public http urls", () => {
  assert.equal(
    normalizePublicHttpUrl(" https://example.com/docs?q=react-vue "),
    "https://example.com/docs?q=react-vue"
  )
})

test("normalizePublicHttpUrl drops unsupported protocols", () => {
  assert.equal(normalizePublicHttpUrl("javascript:alert(1)"), null)
  assert.equal(normalizePublicHttpUrl("file:///tmp/jingle.txt"), null)
})

test("normalizePublicHttpUrl drops authenticated urls", () => {
  assert.equal(normalizePublicHttpUrl("https://user:pass@example.com/secret"), null)
})

test("assertSafePublicHttpUrl rejects localhost targets", async () => {
  await assert.rejects(
    () => assertSafePublicHttpUrl("http://127.0.0.1:3000"),
    /private-network IP addresses/
  )
})
