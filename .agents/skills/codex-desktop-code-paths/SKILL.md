---
name: codex-desktop-code-paths
description: Map Codex Desktop Electron implementation paths from its installed app bundle. Use when reverse engineering Codex Desktop features, locating app.asar/webview/app-server chunks, explaining which Codex files own mention/composer/thread/goal/tool behavior, or comparing those paths to Openwork implementation boundaries.
user_invocable: true
version: "1.0.0"
---

# codex-desktop-code-paths

Use this skill to turn a Codex Desktop behavior into concrete bundle paths, file responsibilities, and an Openwork comparison. Treat Codex as implementation evidence, not as code to copy.

## Boundary

- Verify the installed Codex app for the current machine before making claims; chunk hashes and filenames drift between releases.
- Keep quotes from extracted Codex chunks short. Prefer paraphrased responsibilities and local path references.
- Do not port Codex table names, renderer item models, or UI grouping state into Openwork just because they exist there.
- Always map a finding back to ownership: durable runtime fact, app-server/control API, projection/read model, or local UI display.

## Workflow

1. Locate the app bundle and version.
   - Default bundle: `/Applications/Codex.app/Contents/Resources/app.asar`
   - CLI version, when available: `/Applications/Codex.app/Contents/Resources/codex --version`
2. Extract the Electron asar into a temporary folder.
   - From the Openwork repo root:
     ```bash
     node .agents/skills/codex-desktop-code-paths/scripts/extract-codex-asar.mjs --out /tmp/codex-app-asar
     ```
3. Search the extracted bundle with focused terms.
   - Mention/composer:
     ```bash
     node .agents/skills/codex-desktop-code-paths/scripts/search-codex-bundle.mjs --root /tmp/codex-app-asar --query "workspace-file|atMention|insertAtMention|createFuzzyFileSearchSession"
     ```
   - Thread/goal/tool:
     ```bash
     node .agents/skills/codex-desktop-code-paths/scripts/search-codex-bundle.mjs --root /tmp/codex-app-asar --query "read_thread|thread/goal|thread_dynamic_tools|split-items"
     ```
   - Thread window and pin actions:
     ```bash
     node .agents/skills/codex-desktop-code-paths/scripts/analyze-thread-window-actions.mjs --root /tmp/codex-app-asar
     ```
   - Add `--detail` only when you need bounded line snippets; minified chunks can produce very long lines.
4. Use `references/code-path-map.md` as the starting map, then verify exact filenames in the current extraction. For thread windows, "open in new window", and pin behavior, load `references/thread-window-and-pin.md`.
5. Compare to Openwork by owner boundary, not by surface similarity.

## Common Codex Paths

- `webview/assets/use-workspace-file-search-*.js`: workspace file fuzzy-search hook and ignored directory filters.
- `webview/assets/at-mention-list-*.js`: `@` menu sections, including file-search loading and empty-query states.
- `webview/assets/mention-item-*.js`: reusable mention row layout with icon, primary label, and optional detail.
- `webview/assets/composer-controller-*.js`: ProseMirror mention insertion and `atMention` attrs.
- `webview/assets/inline-mention-content-*.js` and `inline-mention-style-*.js`: inline mention display.
- `webview/assets/app-server-dynamic-tools-*.js`: app-server dynamic tool definitions such as thread read/control tools.
- `webview/assets/app-server-manager-signals-*.js`: app-server signals, goal state, local-store reads, and related control flow.
- `webview/assets/thread-actions-*.js`: thread header actions such as open-in-new-window, copy, rename, archive, and pin wiring.
- `webview/assets/hotkey-window-thread-page-*.js`: separate thread page entry for Codex's hotkey/new-window surface.
- `webview/assets/pinned-threads-query-*.js` and `set-pinned-thread-*.js`: pinned-thread read/write paths; this is thread/sidebar metadata, not a window pin.

## Openwork Comparison Rule

For each Codex path, answer:

- What user behavior does it serve?
- What is the durable fact, if any?
- What is only renderer projection or local display?
- Which Openwork owner should hold the equivalent behavior?
- What is the smallest verifiable Openwork change?
