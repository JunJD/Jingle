import assert from "node:assert/strict"
import test from "node:test"
import {
  getFileMutationReview,
  isFileMutationToolName
} from "../../src/shared/file-mutation-review"

test("identifies file mutation tool names", () => {
  assert.equal(isFileMutationToolName("write_file"), true)
  assert.equal(isFileMutationToolName("edit_file"), true)
  assert.equal(isFileMutationToolName("execute"), false)
})

test("extracts write_file review details", () => {
  const review = getFileMutationReview("write_file", {
    content: "hello\nworld",
    path: "/tmp/demo.txt"
  })

  assert.deepEqual(review, {
    content: "hello\nworld",
    newText: null,
    oldText: null,
    path: "/tmp/demo.txt",
    toolName: "write_file"
  })
})

test("extracts edit_file review details", () => {
  const review = getFileMutationReview("edit_file", {
    new_str: "const next = true",
    old_str: "const next = false",
    path: "/tmp/demo.ts"
  })

  assert.deepEqual(review, {
    content: null,
    newText: "const next = true",
    oldText: "const next = false",
    path: "/tmp/demo.ts",
    toolName: "edit_file"
  })
})

test("extracts edit_file review details from current tool schema aliases", () => {
  const review = getFileMutationReview("edit_file", {
    file_path: "/tmp/demo.ts",
    new_string: "const next = true",
    old_string: "const next = false"
  })

  assert.deepEqual(review, {
    content: null,
    newText: "const next = true",
    oldText: "const next = false",
    path: "/tmp/demo.ts",
    toolName: "edit_file"
  })
})

test("preserves empty strings for file mutation review", () => {
  const writeReview = getFileMutationReview("write_file", {
    content: "",
    path: "/tmp/empty.txt"
  })
  const editReview = getFileMutationReview("edit_file", {
    new_str: "",
    old_str: "",
    path: "/tmp/replace.txt"
  })

  assert.deepEqual(writeReview, {
    content: "",
    newText: null,
    oldText: null,
    path: "/tmp/empty.txt",
    toolName: "write_file"
  })
  assert.deepEqual(editReview, {
    content: null,
    newText: "",
    oldText: "",
    path: "/tmp/replace.txt",
    toolName: "edit_file"
  })
})
