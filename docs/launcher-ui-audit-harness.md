# Launcher UI Audit Harness

`ui-audit:launcher` verifies the styles that actually reach the running Electron renderer. It is not an E2E workflow test and it does not infer style from source class names.

Use it after starting Openwork with a CDP port:

```bash
OPENWORK_REMOTE_DEBUGGING_PORT=9333 npm run dev
npm run ui-audit:launcher
```

The harness connects to `http://127.0.0.1:9333`, finds the launcher renderer page, captures a screenshot, and writes:

```text
test-results/ui-audit/
  launcher-runtime-<timestamp>.png
  launcher-runtime-<timestamp>.json
  launcher-runtime-<timestamp>.md
```

It records:

- runtime `getComputedStyle(...)` for key launcher elements
- composer placeholder style from the real rendered target: Lexical/contenteditable overlay first, native `::placeholder` only for textarea/input
- key CSS token values as resolved in the browser
- DOM density counts for reasoning rows, tool cards, prompt inputs, and buttons
- pixel metrics from the screenshot, including dominant colors and sampled contrast

The first built-in checks focus on style regressions that are easy to miss from source:

- composer placeholder matching foreground text
- long launcher threads dominated by completed tool/reasoning process UI
- composer width nearly spanning the whole launcher viewport

The harness intentionally observes the current launcher state instead of sending messages or creating data. To audit a specific UI state, open that state in the real app first, then run the script.

Composer checks are scoped to `.ow-prompt-input`. The launcher home search textarea is intentionally ignored so the audit does not confuse search placeholder styles with the AI composer.
