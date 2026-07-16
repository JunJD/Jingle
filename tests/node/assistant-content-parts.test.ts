import assert from "node:assert/strict"
import test from "node:test"
import { buildAssistantContentPartsProjection } from "../../src/main/db/assistant-content-parts"

const content = JSON.stringify(
  "Intro\n\n```ts\nconst answer = 42\n```\n\n| Name | Value |\n| --- | --- |\n| answer | 42 |\n\n```mermaid\ngraph TD\n  A --> B\n```"
)

test("durable assistant projection owns typed payloads and revisions", () => {
  const projection = buildAssistantContentPartsProjection({
    content,
    existing: null
  })
  assert.deepEqual(
    projection.parts.map((part) => part.kind),
    ["narrative", "code", "table", "mermaid"]
  )
  const code = projection.parts.find((part) => part.kind === "code")
  assert.deepEqual(code?.payload, { code: "const answer = 42", language: "ts" })
  const table = projection.parts.find((part) => part.kind === "table")
  assert.equal(table?.payload.columns.length, 2)
  assert.equal(table?.payload.rows.length, 1)
  assert.match(projection.contentRevision, /^sha256:[a-f0-9]{64}$/)
  assert.ok(projection.parts.every((part) => /^sha256:[a-f0-9]{64}$/.test(part.revision)))
})

test("reprojection preserves ids for an unchanged durable content revision", () => {
  const firstProjection = buildAssistantContentPartsProjection({
    content,
    existing: null
  })
  const secondProjection = buildAssistantContentPartsProjection({
    content,
    existing: firstProjection
  })
  assert.deepEqual(
    secondProjection.parts.map((part) => part.id),
    firstProjection.parts.map((part) => part.id)
  )
})

test("a unique typed slot keeps identity while its payload revision changes", () => {
  const firstProjection = buildAssistantContentPartsProjection({
    content,
    existing: null
  })
  const secondProjection = buildAssistantContentPartsProjection({
    content: JSON.stringify("Replacement"),
    existing: firstProjection
  })
  assert.notEqual(secondProjection.contentRevision, firstProjection.contentRevision)
  assert.equal(
    secondProjection.parts[0]?.id,
    firstProjection.parts.find((part) => part.kind === "narrative")?.id
  )
  assert.notDeepEqual(
    secondProjection.parts.map((part) => part.revision),
    firstProjection.parts.map((part) => part.revision)
  )
})

test("unchanged unique parts retain identity when sibling parts reorder", () => {
  const firstProjection = buildAssistantContentPartsProjection({
    content: JSON.stringify(
      "Alpha\n\n```ts\nconst one = 1\n```\n\n```mermaid\ngraph TD\nA-->B\n```"
    ),
    existing: null
  })
  const secondProjection = buildAssistantContentPartsProjection({
    content: JSON.stringify(
      "```mermaid\ngraph TD\nA-->B\n```\n\nAlpha\n\n```ts\nconst one = 1\n```"
    ),
    existing: firstProjection
  })

  const firstIds = new Map(firstProjection.parts.map((part) => [part.revision, part.id]))
  assert.ok(secondProjection.parts.every((part) => firstIds.get(part.revision) === part.id))
})

test("duplicate blocks retain ordinal identities when a sibling changes", () => {
  const duplicate = "```ts\nconst same = true\n```"
  const first = buildAssistantContentPartsProjection({
    content: JSON.stringify(`Before\n\n${duplicate}\n\nMiddle\n\n${duplicate}\n\nAfter`),
    existing: null
  })
  const second = buildAssistantContentPartsProjection({
    content: JSON.stringify(`Before edited\n\n${duplicate}\n\nMiddle\n\n${duplicate}\n\nAfter`),
    existing: first
  })
  const firstCodeIds = first.parts.filter((part) => part.kind === "code").map((part) => part.id)
  const secondCodeIds = second.parts.filter((part) => part.kind === "code").map((part) => part.id)

  assert.deepEqual(secondCodeIds, firstCodeIds)
})

test("table edits preserve the card, columns, and unchanged row identities", () => {
  const first = buildAssistantContentPartsProjection({
    content: JSON.stringify("| Name | Status |\n| --- | --- |\n| Alpha | Open |\n| Beta | Open |"),
    existing: null
  })
  const second = buildAssistantContentPartsProjection({
    content: JSON.stringify(
      "| Name | Status |\n| --- | --- |\n| Alpha | Resolved |\n| Beta | Open |"
    ),
    existing: first
  })
  const firstTable = first.parts.find((part) => part.kind === "table")
  const secondTable = second.parts.find((part) => part.kind === "table")
  assert.ok(firstTable)
  assert.ok(secondTable)
  assert.equal(secondTable.id, firstTable.id)
  assert.deepEqual(
    secondTable.payload.columns.map((column) => column.id),
    firstTable.payload.columns.map((column) => column.id)
  )
  assert.equal(secondTable.payload.rows[1]?.id, firstTable.payload.rows[1]?.id)
  assert.notEqual(secondTable.payload.rows[0]?.id, firstTable.payload.rows[0]?.id)
})
