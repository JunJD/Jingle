const types = ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "test"]

const scopes = [
  "agent",
  "annotation",
  "apple-reminders",
  "attachments",
  "checkpoint",
  "clipboard",
  "coffee",
  "composer",
  "computer-use",
  "content-card",
  "db",
  "deps",
  "devtools",
  "diagnostics",
  "extension",
  "extension-cli",
  "extension-host",
  "extension-sdk",
  "figma-files",
  "github",
  "hitl",
  "launcher",
  "main-window",
  "memory",
  "model-provider",
  "native",
  "notion",
  "release",
  "renderer",
  "repo",
  "runtime",
  "settings",
  "thread-digest",
  "thread-workflow",
  "tracing",
  "workspace"
]

export default {
  defaultIgnores: false,
  extends: ["@commitlint/config-conventional"],
  helpUrl: "https://github.com/JunJD/Jingle/blob/main/CONTRIBUTING.md#commit-messages",
  plugins: [
    {
      rules: {
        "breaking-change-footer": ({ body, footer, header }) => {
          const hasBreakingMarker = /^[a-z]+\([^)]+\)!:/.test(header ?? "")
          const hasBreakingFooter = /^BREAKING CHANGE:\s+\S/m.test(`${body ?? ""}\n${footer ?? ""}`)
          return [
            hasBreakingMarker === hasBreakingFooter,
            "breaking commits must use type(scope)!: and include a BREAKING CHANGE: footer"
          ]
        },
        "revert-original-sha": ({ body, footer, type }) => [
          type !== "revert" ||
            /^Reverts:\s+[0-9a-fA-F]{7,40}\b/m.test(`${body ?? ""}\n${footer ?? ""}`),
          "revert commits must include Reverts: <original SHA> after the header"
        ],
        "subject-terminal-punctuation": ({ subject }) => [
          !/[.。]$/.test(subject ?? ""),
          "subject must not end with an English or Chinese period"
        ]
      }
    }
  ],
  rules: {
    "body-max-line-length": [0],
    "breaking-change-footer": [2, "always"],
    "footer-max-line-length": [0],
    "header-max-length": [2, "always", 72],
    "scope-empty": [2, "never"],
    "scope-enum": [2, "always", scopes],
    "revert-original-sha": [2, "always"],
    "subject-case": [0],
    "subject-empty": [2, "never"],
    "subject-full-stop": [0],
    "subject-terminal-punctuation": [2, "always"],
    "type-enum": [2, "always", types]
  }
}
