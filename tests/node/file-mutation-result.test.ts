import assert from "node:assert/strict"
import test from "node:test"

import {
  FILE_MUTATION_RESULT_METADATA_KEY,
  readFileMutationResultMetadata
} from "../../src/shared/file-mutation-result"

test("readFileMutationResultMetadata rejects file entries without content facts", () => {
  assert.equal(
    readFileMutationResultMetadata({
      metadata: {
        [FILE_MUTATION_RESULT_METADATA_KEY]: {
          files: [
            {
              after: null,
              before: null,
              changeType: "modify",
              path: "src/app.ts"
            }
          ],
          status: "completed",
          toolCallId: "tool-call-1",
          toolName: "edit_file"
        }
      }
    }),
    null
  )
})

test("readFileMutationResultMetadata rejects partial file lists", () => {
  assert.equal(
    readFileMutationResultMetadata({
      metadata: {
        [FILE_MUTATION_RESULT_METADATA_KEY]: {
          files: [
            {
              after: "new",
              before: "old",
              changeType: "modify",
              path: "src/app.ts"
            },
            {
              after: "created",
              changeType: "create",
              path: "src/new.ts"
            }
          ],
          status: "completed",
          toolCallId: "tool-call-1",
          toolName: "edit_file"
        }
      }
    }),
    null
  )
})

test("readFileMutationResultMetadata preserves unknown completed result change type", () => {
  assert.deepEqual(
    readFileMutationResultMetadata({
      metadata: {
        [FILE_MUTATION_RESULT_METADATA_KEY]: {
          files: [
            {
              after: "hello",
              before: null,
              changeType: null,
              path: "src/notes.md"
            }
          ],
          status: "completed",
          toolCallId: "tool-call-1",
          toolName: "write_file"
        }
      }
    }),
    {
      files: [
        {
          after: "hello",
          before: null,
          changeType: null,
          path: "src/notes.md"
        }
      ],
      status: "completed",
      toolCallId: "tool-call-1",
      toolName: "write_file"
    }
  )
})
