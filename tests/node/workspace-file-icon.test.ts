import assert from "node:assert/strict"
import test from "node:test"
import { getWorkspaceFileIconKind } from "../../src/renderer/src/components/workspace-file-icon"

test("workspace file icon kind covers common engineering file groups", () => {
  const cases: Array<[string, ReturnType<typeof getWorkspaceFileIconKind>]> = [
    ["src/App.tsx", "react"],
    ["src/main.ts", "typescript"],
    ["scripts/build.mjs", "javascript"],
    ["src/main.py", "code"],
    ["styles/index.css", "code"],
    ["public/index.html", "html"],
    ["package.json", "json"],
    ["config/settings.yaml", "config"],
    [".env.local", "config"],
    ["docs/notes.md", "document"],
    ["assets/logo.svg", "image"],
    ["reports/data.xlsx", "spreadsheet"],
    ["slides/intro.pptx", "presentation"],
    ["notebooks/model.ipynb", "notebook"],
    ["scripts/deploy.zsh", "shell"],
    ["Dockerfile", "shell"],
    ["BUILD.bazel", "build"],
    ["checksums/release.sha256", "hash"],
    ["archive/source.tgz", "archive"],
    ["paper.pdf", "pdf"],
    ["unknown.custom", "file"]
  ]

  for (const [name, kind] of cases) {
    assert.equal(getWorkspaceFileIconKind(name), kind, name)
  }
})
