# Codex Desktop Code Path Map

This map is seeded from `docs/codex-desktop-openwork-agent-harness-gap-cn.md` plus local Codex Desktop bundle inspection. Re-verify filenames after every Codex Desktop update because Vite chunk hashes change.

## Package And Stores

| Path                                                  | Responsibility                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/Applications/Codex.app/Contents/Resources/app.asar` | Electron application bundle containing webview assets and app-server chunks.                              |
| `/Applications/Codex.app/Contents/Resources/codex`    | Bundled Codex CLI; useful for installed version checks.                                                   |
| `~/.codex/state_5.sqlite`                             | Local Codex state store. Known tables include threads, dynamic tools, spawn edges, jobs, and job items.   |
| `~/.codex/goals_1.sqlite`                             | Local goal store. Keep goal facts separate from ordinary conversation projection when comparing behavior. |

## Mention And Composer

| Chunk pattern                                            | Responsibility                                                                                                           | Openwork comparison                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `webview/assets/use-workspace-file-search-*.js`          | Creates and updates fuzzy file search sessions from workspace roots; filters common generated/vendor directories.        | Openwork equivalent starts in `src/main/workspace/service.ts` and renderer hook `use-workspace-file-mentions.ts`. |
| `webview/assets/at-mention-list-*.js`                    | Builds the `@` menu sections for agents, plugins, skills, files, and MCP; file section has loading and empty-query rows. | Openwork equivalent is `src/renderer/src/composer-area/extension-source-typeahead.tsx`.                           |
| `webview/assets/mention-item-*.js`                       | Shared row UI: icon, primary label, optional secondary detail.                                                           | Openwork should keep file name primary and directory/path secondary.                                              |
| `webview/assets/composer-controller-*.js`                | Defines ProseMirror `atMention` attrs and insertion; file mentions keep display label separate from path/fsPath.         | Openwork equivalent is Lexical node insertion in `extension-source-typeahead.tsx` plus `file-reference-node.ts`.  |
| `webview/assets/inline-mention-content-*.js`             | Renders inline mention content with brand-aware styling and optional icon.                                               | Openwork inline node should display the human label, not the full file path.                                      |
| `webview/assets/inline-mention-style-*.js`               | Shared inline mention color and typography behavior.                                                                     | Openwork equivalent lives in node DOM classes and global design tokens.                                           |
| `webview/assets/workspace-file-command-menu-bridge-*.js` | Bridges command-menu file search into composer insertion/open actions.                                                   | Openwork currently uses composer typeahead and workspace IPC rather than a separate file command menu.            |

Codex mention behavior to preserve as product evidence:

- Search result row: file icon, file name as the primary label, containing directory/path as secondary detail.
- Inserted mention: human label is separate from `path`/`fsPath`; path remains machine context, not the visible text.
- Empty file query: show a clear "type to search files" state rather than pretending files are unavailable.

## Thread, Goal, And Tool Activity

| Chunk or store                                    | Responsibility                                                                                                                          | Openwork comparison                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `webview/assets/app-server-dynamic-tools-*.js`    | Defines dynamic app-server tools such as `read_thread`, create/list/send/fork/thread metadata controls, and their returned read models. | Openwork should expose explicit control APIs only when needed; do not let renderer stores become agent tools.                 |
| `webview/assets/app-server-manager-signals-*.js`  | Handles app-server signals, goal get/set/update/clear paths, thread state updates, and local persistence reads.                         | Openwork shared runtime state belongs in `src/shared/agent-thread-runtime.ts`; durable facts belong in main/runtime services. |
| `webview/assets/split-items-into-render-groups-*.js` when manually formatted | Derives renderer item groups such as collapsed tool activity, pending MCP calls, dynamic tool groups, and approval cards.               | Openwork equivalent is projection/UI display, not core runtime state.                                                         |
| `state_5.sqlite.thread_dynamic_tools`             | Records per-thread dynamic tool availability and schemas.                                                                               | Openwork extension schema loading should be a session/tool-availability fact only if product semantics need it.               |
| `state_5.sqlite.thread_spawn_edges`               | Records parent/child thread relationships.                                                                                              | Openwork should add durable delegated-work edges only if subagents become resumable/auditable child work units.               |
| `state_5.sqlite.agent_jobs` and `agent_job_items` | Batch-job orchestration.                                                                                                                | Do not introduce Openwork job runtime until there is a real batch-product workflow.                                           |
| `goals_1.sqlite.thread_goals`                     | Thread goal facts.                                                                                                                      | Keep goals as explicit durable/product state, separate from message text or render grouping.                                  |

## Thread Window And Pin Actions

For a deeper thread/window report, run:

```bash
node .agents/skills/codex-desktop-code-paths/scripts/analyze-thread-window-actions.mjs --root /tmp/codex-app-asar
```

| Chunk pattern                                      | Responsibility                                                                                                         | Openwork comparison                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `webview/assets/thread-actions-*.js`               | Header action owner for open-in-new-window, more actions, copy, rename, archive, and pin wiring.                       | Keep thread action menu separate from composer/bottom actions.                                                |
| `webview/assets/hotkey-window-thread-page-*.js`    | Separate Codex thread page entry for a hotkey/new-window surface.                                                      | Add a separate Openwork window kind for pinned AI session windows instead of making launcher permanent.        |
| `webview/assets/local-conversation-page-*.js`      | Reusable local conversation page host that receives thread id, title/cwd metadata, and action capabilities.            | Extract an Openwork `AiSessionSurface` from the launcher-specific host.                                       |
| `webview/assets/pinned-threads-query-*.js`         | Reads pinned thread list.                                                                                              | Treat "置顶对话" as thread/history metadata.                                                                 |
| `webview/assets/set-pinned-thread-*.js`            | Writes pinned thread membership/order.                                                                                 | Do not use thread pin APIs for window always-on-top or pinned session windows.                                |
| `webview/assets/app-server-dynamic-tools-*.js`     | Exposes thread read/control tools such as create/list/read/send/fork/pin/archive/title.                                | Keep Openwork agent-facing thread control in main/preload services, not renderer component state.             |

Product distinction:

- "Open in new window" creates or targets another thread surface.
- "Pin chat" affects thread/sidebar/history membership.
- A persistent pinned session window in Openwork should be a window/session surface feature, not a reinterpretation of thread pin.

## Evidence Report Template

```text
Codex behavior:
- User-facing behavior:
- Current Codex files/chunks:
- Durable facts:
- Projection/UI-only pieces:

Openwork mapping:
- Current owner:
- Missing owner, if any:
- Minimal change:
- Verification:

Do not copy:
- Tables/chunks/models that are not required by the Openwork behavior.
```
