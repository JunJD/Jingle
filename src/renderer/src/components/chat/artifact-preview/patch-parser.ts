import {
  parsePatch as parseUnifiedPatch,
  type StructuredPatch,
  type StructuredPatchHunk
} from "diff"

export type DiffRow = {
  kind: "meta" | "hunk" | "add" | "remove" | "context"
  newLineNumber: number | null
  oldLineNumber: number | null
  text: string
}

export type ParsedPatch = {
  additions: number
  deletions: number
  files: number
  hunks: number
  rows: DiffRow[]
}

export function parsePatch(text: string): ParsedPatch {
  const files = parseUnifiedPatch(text)
  const rows: DiffRow[] = []
  let additions = 0
  let deletions = 0
  let hunks = 0

  for (const file of files) {
    rows.push(...toFileMetaRows(file))

    for (const hunk of file.hunks) {
      hunks += 1
      rows.push(createDiffRow("hunk", formatHunkHeader(hunk)))

      let oldLineNumber = hunk.oldStart
      let newLineNumber = hunk.newStart

      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          rows.push({
            kind: "add",
            newLineNumber,
            oldLineNumber: null,
            text: line
          })
          additions += 1
          newLineNumber += 1
          continue
        }

        if (line.startsWith("-")) {
          rows.push({
            kind: "remove",
            newLineNumber: null,
            oldLineNumber,
            text: line
          })
          deletions += 1
          oldLineNumber += 1
          continue
        }

        if (line.startsWith("\\")) {
          rows.push(createDiffRow("meta", line))
          continue
        }

        rows.push({
          kind: "context",
          newLineNumber,
          oldLineNumber,
          text: line
        })
        oldLineNumber += 1
        newLineNumber += 1
      }
    }
  }

  return {
    additions,
    deletions,
    files: files.length,
    hunks,
    rows
  }
}

function toFileMetaRows(file: StructuredPatch): DiffRow[] {
  const rows: DiffRow[] = []

  if (file.isGit && file.oldFileName && file.newFileName) {
    rows.push(createDiffRow("meta", `diff --git ${file.oldFileName} ${file.newFileName}`))
  }

  if (file.isCreate && file.newMode) {
    rows.push(createDiffRow("meta", `new file mode ${file.newMode}`))
  } else if (file.isDelete && file.oldMode) {
    rows.push(createDiffRow("meta", `deleted file mode ${file.oldMode}`))
  } else if (file.oldMode && file.newMode && file.oldMode !== file.newMode) {
    rows.push(createDiffRow("meta", `old mode ${file.oldMode}`))
    rows.push(createDiffRow("meta", `new mode ${file.newMode}`))
  }

  if (file.isRename) {
    if (file.oldFileName) {
      rows.push(createDiffRow("meta", `rename from ${stripDiffPathPrefix(file.oldFileName)}`))
    }
    if (file.newFileName) {
      rows.push(createDiffRow("meta", `rename to ${stripDiffPathPrefix(file.newFileName)}`))
    }
  }

  if (file.isCopy) {
    if (file.oldFileName) {
      rows.push(createDiffRow("meta", `copy from ${stripDiffPathPrefix(file.oldFileName)}`))
    }
    if (file.newFileName) {
      rows.push(createDiffRow("meta", `copy to ${stripDiffPathPrefix(file.newFileName)}`))
    }
  }

  if (file.isBinary) {
    rows.push(createDiffRow("meta", "Binary files differ"))
  }

  if (file.oldFileName !== undefined) {
    rows.push(createDiffRow("meta", `--- ${file.oldFileName}`))
  }

  if (file.newFileName !== undefined) {
    rows.push(createDiffRow("meta", `+++ ${file.newFileName}`))
  }

  return rows
}

function formatHunkHeader(hunk: StructuredPatchHunk): string {
  return `@@ -${formatHunkRange(hunk.oldStart, hunk.oldLines)} +${formatHunkRange(hunk.newStart, hunk.newLines)} @@`
}

function formatHunkRange(start: number, lines: number): string {
  return lines === 1 ? String(start) : `${start},${lines}`
}

function stripDiffPathPrefix(fileName: string): string {
  if (
    fileName.startsWith("a/") ||
    fileName.startsWith("b/") ||
    fileName.startsWith("i/") ||
    fileName.startsWith("w/") ||
    fileName.startsWith("c/") ||
    fileName.startsWith("o/")
  ) {
    return fileName.slice(2)
  }

  return fileName
}

function createDiffRow(kind: DiffRow["kind"], text: string): DiffRow {
  return {
    kind,
    newLineNumber: null,
    oldLineNumber: null,
    text
  }
}
