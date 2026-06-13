# Find Local Logs

[中文](./find-logs-cn.md)

Openwork/Jingle writes local diagnostic logs so you can understand failures and
share useful support information without sending an entire workspace.

## Log Location

By default, logs are under:

```text
~/.openwork/logs/openwork.log
```

If the app was started with `OPENWORK_HOME`, logs are under:

```text
$OPENWORK_HOME/logs/openwork.log
```

The app rotates log files when they grow, so you may also see files such as
`openwork.log.1`.

## What Logs Can Include

Logs can include:

- app startup and shutdown,
- Electron and platform information,
- window load failures,
- renderer errors reported to the main process,
- renderer console warnings or errors,
- process crash or unresponsive-window events.

Logs are for diagnostics. They should not be treated as a full audit trail of
every model token or workspace file.

## Before Sharing Logs

Before sharing a log:

1. Remove API keys, tokens, local usernames, private paths, or sensitive project names.
2. Include the app version and operating system.
3. Include what you were doing when the issue happened.
4. Include the relevant time range instead of the entire log directory when possible.

If the issue involves an extension, mention which extension and whether it was
connected in Settings -> Extensions.
