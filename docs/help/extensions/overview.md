# Extensions Overview

[中文](./overview-cn.md)

Extensions add commands, surfaces, settings, and AI capabilities to the launcher
and agent workflow.

## Where Extensions Appear

Extensions can appear in:

- launcher search,
- launcher command pages,
- Settings -> Extensions,
- AI mentions and capability loading,
- menu bar items,
- quicklinks.

Some extensions are built in. Some are bundled installable packages. User
installed packages can also be loaded from the local Openwork data directory.

## Current First-Party Extensions

Built-in or bundled capabilities include:

- Todo List: local lightweight task capture and organization.
- Translate: model-backed translation from selected text or free-form input.
- Image Generation: generate or edit images from AI chat after configuring an
  image API key.
- Apple Reminders: macOS reminders commands, menu bar, and AI tools.
- GitHub: OAuth-backed issues, pull requests, repositories, notifications, and
  workflow runs.
- Notion: connected Notion pages, data sources, quick capture, and AI tools.
- Figma Files: connected team file search and quick access.

## Connections And Preferences

Open Settings -> Extensions to configure extension preferences or connect
accounts. OAuth-backed extensions open a browser authorization page and return to
the app through the `jingle://` app scheme.

Connection tokens are used by the local app runtime. Treat connected extensions
as access to the corresponding external account.

## AI Capabilities

Some extensions expose AI tools. The agent sees a lightweight capability catalog
first. When a task needs a specific extension, the app loads that extension's
tool details and runs the tool through the extension runtime.

If an extension is not connected or missing required preferences, the agent
should tell you to configure it before using its tools.

## Quicklinks

Quicklinks save frequently used extension commands or launch contexts. Manage
them from Settings -> Quicklinks or create them from supported extension actions.
