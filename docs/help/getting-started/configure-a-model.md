# Configure A Model

[中文](./configure-a-model-cn.md)

Agent runs need a configured model. Open Settings -> Models to add credentials,
choose available models, and set the default model used by new launcher AI tasks.

## Add A Provider

1. Open the launcher.
2. Open Settings.
3. Choose the Models tab.
4. Add or edit a provider credential.
5. Save and wait for the model list to load.

The Models tab is the current source of truth for available models. Avoid relying
on old static model lists in docs or release notes.

## Provider Types

Openwork/Jingle can use:

- built-in provider adapters,
- configured cloud providers,
- local model registries,
- custom OpenAI-compatible endpoints.

Some providers fetch their model list remotely after credentials are saved. If a
provider returns no supported chat models, the model list will show an error or
the provider will remain unavailable for agent runs.

## Default Model

New launcher AI tasks use the app default model unless you choose another model
from the launcher AI header. Extension commands can also expose their own model
preference when they need one.

## Troubleshooting

If a run cannot start:

- confirm a provider is configured in Settings -> Models,
- confirm the selected model is available,
- check whether the provider key was saved correctly,
- use [local logs](../logs-and-diagnostics/find-logs.md) when the UI error does
  not explain the failure.
