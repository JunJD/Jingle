# Codex Thread Window And Pin Evidence

Use this reference when comparing Codex Desktop's thread header actions, "open in new window", and thread pinning to Openwork launcher/session-window behavior.

## Reproduce The Evidence

From the Openwork repo root:

```bash
node .agents/skills/codex-desktop-code-paths/scripts/extract-codex-asar.mjs \
  --out /tmp/codex-app-asar-window-research \
  --force

node .agents/skills/codex-desktop-code-paths/scripts/analyze-thread-window-actions.mjs \
  --root /tmp/codex-app-asar-window-research
```

If `node` is not on PATH inside Codex Desktop, use the bundled runtime:

```bash
/Users/junjieding/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  .agents/skills/codex-desktop-code-paths/scripts/analyze-thread-window-actions.mjs \
  --root /tmp/codex-app-asar-window-research
```

## 2026-06-11 Local Snapshot

This snapshot was verified against local Codex Desktop CLI `codex-cli 0.138.0-alpha.7` from `/Applications/Codex.app/Contents/Resources/codex`.

Chunk hashes drift, so treat the file names below as snapshot evidence, not stable API names.

| Codex chunk | Evidence | Product meaning |
| --- | --- | --- |
| `webview/assets/thread-actions-BQmectH9.js` | Owns `threadHeader.openInNewWindow`, `threadHeader.moreActions`, copy, rename, archive, and thread pin toggle wiring. | Header menu actions are thread-level actions. "Open in new window" is separate from pinning. |
| `webview/assets/pinned-threads-query-Cl6DI8bn.js` | Calls `list-pinned-threads`. | Pinning is sidebar/history membership metadata. |
| `webview/assets/set-pinned-thread-Cfyf0hbx.js` | Calls `set-thread-pinned` and `set-pinned-threads-order`. | Thread pin is not a window always-on-top flag. |
| `webview/assets/local-conversation-page-PAyyIYwu.js` | Hosts local conversation/thread page and passes thread action props such as title, cwd, pin capability, and fork visibility. | Thread page is the reusable conversation surface owner. |
| `webview/assets/hotkey-window-thread-page-CQd4KR1O.js` | Separate hotkey-window thread page chunk that imports local conversation/thread page dependencies. | Codex has a separate window/page entry for a thread view instead of making the launcher itself permanent. |
| `webview/assets/app-server-dynamic-tools-LoTaSv01.js` | Defines thread tools such as `create_thread`, `list_threads`, `read_thread`, `send_message_to_thread`, `fork_thread`, `set_thread_pinned`, `set_thread_archived`, and `set_thread_title`. | Agent-facing thread control belongs to a control/read-model boundary, not renderer local state. |

## Openwork Mapping

| Codex behavior | Openwork owner | Boundary rule |
| --- | --- | --- |
| Open current thread in a new window | `src/main/windows/*`, `src/main/index.ts`, renderer `?window=` routing | Add a separate window kind; do not mutate launcher blur-hide semantics. |
| Pin/unpin a thread | thread metadata/history owner | Keep this separate from "pinned session window". Use wording like "置顶对话" only for thread history pin. |
| Reusable thread page | `src/renderer/src/ai-core` | Extract an inner session surface from launcher-specific host code. |
| Dynamic thread controls | main/preload thread control APIs | Do not expose renderer stores as agent tools. |

## Openwork Implementation Implication

The equivalent Openwork feature should be "钉出窗口" or "打开会话窗口":

- The launcher remains a transient search/AI entry.
- A click creates a separate BrowserWindow for the current `threadId`.
- Each click can create a new window, capped by a main-process registry.
- Thread pin remains history/sidebar metadata.
- Message/runtime truth continues to come from main runtime snapshot and event subscription.

Do not copy Codex chunk names, table names, or renderer grouping models into Openwork. Use them only as evidence for ownership and user-facing behavior.
