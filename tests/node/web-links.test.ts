import test from "node:test"
import assert from "node:assert/strict"
import {
  assertSafePublicHttpUrl,
  normalizePublicHttpUrl
} from "../../src/main/services/web-tools/url-guard"

test("normalizePublicHttpUrl keeps valid public http urls", () => {
  assert.equal(
    normalizePublicHttpUrl(" https://example.com/docs?q=react-vue "),
    "https://example.com/docs?q=react-vue"
  )
})

test("normalizePublicHttpUrl drops unsupported protocols", () => {
  assert.equal(normalizePublicHttpUrl("javascript:alert(1)"), null)
  assert.equal(normalizePublicHttpUrl("file:///tmp/openwork.txt"), null)
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
