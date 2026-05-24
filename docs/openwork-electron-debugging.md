# Openwork Electron Debugging

This guide covers the practical debugging path when you want to inspect or drive the real Openwork Electron window with CDP-based tools such as `agent-browser`, `dev3000`, or Chrome DevTools.

## What Works

Openwork can expose its Electron renderer as a standard Chromium CDP target when started with `OPENWORK_REMOTE_DEBUGGING_PORT`.

That means you can:

- inspect the real renderer DOM
- capture screenshots
- read console and network activity
- drive the UI with `agent-browser`

What this does not replace:

- main process debugging still happens in the terminal running `npm run dev`
- preload and IPC debugging still requires reading the code path through `src/preload` and `src/main`
- `d3k` should not be treated as the process that launches Openwork itself; for Electron, the useful part is its CDP client path

## Recommended Flow

### 1. Start an isolated Electron instance

Use the helper script:

```bash
.agents/skills/openwork-electron-cdp/scripts/start_isolated_electron_cdp.sh 9333
```

What this does:

1. creates a temporary `OPENWORK_HOME`
2. runs Prisma migrations for that temp home
3. sets `OPENWORK_BDD=1` to bypass the single-instance lock
4. sets `OPENWORK_REMOTE_DEBUGGING_PORT=9333`
5. starts `npm run dev`

This is the safest path because it does not depend on closing your already-running Openwork app.

### 2. Verify the CDP target

In another terminal:

```bash
curl -sf http://127.0.0.1:9333/json/version
curl -sf http://127.0.0.1:9333/json
```

Expected result:

- `/json/version` returns an `Electron/...` user agent
- `/json` includes a `type: "page"` entry
- the page URL usually looks like `http://localhost:<vite-port>/?window=launcher`

### 3. Attach `agent-browser`

Always use a named session so you do not collide with the default local daemon socket:

```bash
bun x agent-browser --session openwork-d3k --cdp 9333 get url
bun x agent-browser --session openwork-d3k --cdp 9333 snapshot -i
```

Useful commands:

```bash
bun x agent-browser --session openwork-d3k --cdp 9333 click @e2
bun x agent-browser --session openwork-d3k --cdp 9333 fill @e6 "hello"
bun x agent-browser --session openwork-d3k --cdp 9333 screenshot /tmp/openwork-electron.png
bun x agent-browser --session openwork-d3k --cdp 9333 console
bun x agent-browser --session openwork-d3k --cdp 9333 errors
```

### 4. If you specifically want `dev3000` / `d3k`

Use it as a client against the already-running Electron CDP port.

Examples:

```bash
d3k agent-browser --session openwork-d3k --cdp 9333 get url
d3k agent-browser --session openwork-d3k --cdp 9333 snapshot -i
```

Do not expect `d3k`'s default "start the app server and launch Chrome" flow to be the right model for Openwork. Openwork is already the Chromium host.

## Attaching to Your Current Openwork Instance

Only do this if you explicitly want to debug the instance you are already using.

Start Openwork with:

```bash
OPENWORK_REMOTE_DEBUGGING_PORT=9333 npm run dev
```

Important:

- if another Openwork instance is already running, Electron's single-instance lock can cause the new process to hand off and exit
- if that happens, use the isolated script instead

## Debugging by Layer

### Renderer

- attach via CDP as shown above
- in dev mode, `F12` toggles DevTools for the Electron window

### Preload

- read `src/preload/index.ts`
- confirm which APIs are exposed with `contextBridge.exposeInMainWorld`
- if a renderer action fails, check whether the preload API exists and whether it calls the expected IPC channel

### Main Process

- watch the terminal running `npm run dev`
- inspect `src/main/index.ts`, `src/main/composition-root.ts`, and the relevant domain controller/module
- follow the boundary: renderer -> preload -> ipcMain -> service/window code

## Troubleshooting

### `curl http://127.0.0.1:9333/json` fails

- the Electron app did not start with `OPENWORK_REMOTE_DEBUGGING_PORT`
- the process exited due to the single-instance lock
- the port is wrong or already occupied by something else

### `agent-browser` fails to start its daemon

Use a non-default session:

```bash
bun x agent-browser --session openwork-d3k --cdp 9333 snapshot -i
```

### The target is not Openwork

Check `/json` again and confirm the page URL points at the Openwork renderer port, not some other Chromium page.

### You need a different port

Pick another local port and keep it consistent:

```bash
.agents/skills/openwork-electron-cdp/scripts/start_isolated_electron_cdp.sh 9444
bun x agent-browser --session openwork-d3k --cdp 9444 snapshot -i
```
