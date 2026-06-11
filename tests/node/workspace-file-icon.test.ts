import assert from "node:assert/strict"
import test from "node:test"
import {
  getWorkspaceFileIconBadge,
  getWorkspaceFileIconKind
} from "../../src/renderer/src/components/workspace-file-icon"

test("workspace file icon kind covers common engineering file groups", () => {
  const cases: Array<[string, ReturnType<typeof getWorkspaceFileIconKind>]> = [
    ["src/App.tsx", "react"],
    ["src/main.ts", "typescript"],
    ["scripts/build.mjs", "javascript"],
    ["src/main.py", "python"],
    ["src/lib.rs", "rust"],
    ["src/main.java", "java"],
    ["src/Main.hs", "code"],
    ["styles/index.css", "css"],
    ["public/index.html", "html"],
    ["package.json", "json"],
    ["config/settings.yaml", "yaml"],
    ["config/settings.toml", "toml"],
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

test("workspace file icon badge uses the same file kind map", () => {
  assert.deepEqual(getWorkspaceFileIconBadge("src/main.ts"), {
    className: "bg-[#4d4b69] text-white/82",
    kind: "typescript",
    label: "TS"
  })
  assert.deepEqual(getWorkspaceFileIconBadge("AGENTS.md"), {
    className: "bg-slate-200 text-slate-600",
    kind: "document",
    label: "TXT"
  })
})
