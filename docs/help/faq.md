# FAQ

[中文](./faq-cn.md)

## Is Openwork/Jingle local-first?

The desktop workspace, thread state, memory records, artifacts, settings, and
logs are local-first. External model providers and connected extensions still
send requests to the providers or services you configure.

## What can the agent read or change?

The agent works inside the selected workspace and with the files, context,
extensions, and tools available to the task. Commands, edits, and external write
actions can require approval depending on the permission mode and tool policy.

## Where are model keys stored?

Configure model providers in Settings -> Models. Treat saved provider
credentials as sensitive local app data. Use the Settings UI as the current
source of truth for configured providers and available models.

## Why do I need to approve a command?

Approvals protect actions that can affect your files, computer, or connected
accounts. Read the approval card and reject anything that is surprising, too
broad, or unrelated to your task.

## How do I stop or recover a run?

Use the stop control in the AI surface for a running task. Previous work remains
in the thread. You can return from the history window or thread search, then
continue or fork the thread.

## How do I delete or control memory?

Use Settings -> Memory. Memory is local-first and user-controlled. You can review
saved memories, handle suggestions, and turn memory behavior on or off from that
tab.

## Which extensions require OAuth?

GitHub, Notion, and Figma Files use OAuth-backed account connections in the
current first-party extension set. Apple Reminders uses the local macOS Reminders
database. Image Generation requires an API key preference.

## Where are logs?

By default, logs are in `~/.openwork/logs/openwork.log`. If `OPENWORK_HOME` is
set, logs are in `$OPENWORK_HOME/logs/openwork.log`.

## What is the difference between the launcher and the history window?

The launcher is the quick entry surface for search, commands, AI tasks, and
extension workflows. The history window is where you return to previous threads
and inspect persistent work.

## What is the difference between the npm package and the desktop release?

The npm package can be run with `npx openwork` or installed globally. Desktop
release assets are packaged app builds attached to GitHub Releases for each
platform.
