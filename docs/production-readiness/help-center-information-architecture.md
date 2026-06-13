# Help Center Information Architecture

This is the proposed production help center IA for `docs/help`. The help center
is user-facing. It should be short, task-oriented, and tied to current product
behavior. Dev-only commands, migration history, and architecture debate belong in
dev docs or archive docs.

## IA Principles

- Start from what the user sees: launcher, settings, agent runs, extensions,
  approvals, logs.
- Every page should answer "where is this in the app?" and "what should I do
  next?"
- Pages that mention local files, shell commands, OAuth, or model keys must state
  the trust boundary plainly.
- Do not duplicate current code internals in help pages. Link to dev docs only
  when a developer needs implementation detail.

## Proposed Tree

```text
docs/help/
  README.md
  getting-started/
    install-and-open.md
    first-agent-run.md
    choose-a-workspace.md
    configure-a-model.md
  core-concepts/
    launcher.md
    workspace.md
    threads-and-history.md
    permission-modes.md
    artifacts.md
    local-first-memory.md
  agent-workflows/
    start-from-launcher.md
    use-files-and-mentions.md
    review-approvals.md
    stop-resume-and-fork.md
    inspect-results.md
  extensions/
    overview.md
    todo-list.md
    translate.md
    image-generation.md
    apple-reminders.md
    github.md
    notion.md
    figma-files.md
    quicklinks.md
  settings-models/
    settings-overview.md
    model-providers.md
    memory-settings.md
    appearance.md
    shortcuts.md
  troubleshooting/
    model-setup.md
    workspace-and-files.md
    approvals-and-permissions.md
    extension-connections.md
    apple-reminders.md
    shortcuts.md
    packaging-installation.md
  logs-and-diagnostics/
    find-logs.md
    share-a-diagnostic-report.md
    electron-debugging-for-support.md
  faq.md
```

## Section Details

### Getting Started

Goal: get a new user from install/open to a successful first run.

Required pages:

- `install-and-open.md`: install options, app launch, launcher as first screen.
- `first-agent-run.md`: send first request, understand visible progress, stop/cancel.
- `choose-a-workspace.md`: workspace trust boundary, what files agent can read/write.
- `configure-a-model.md`: open Settings -> Models, add credentials, pick default model.

Acceptance:

- A new user can open the app, configure a model, choose a workspace, run one task, and find the output without reading dev docs.

### Core Concepts

Goal: explain durable product mental models.

Required pages:

- `launcher.md`: root search, commands, app/file/thread results, quicklinks.
- `workspace.md`: local workspace, default workspace, per-thread workspace.
- `threads-and-history.md`: main history window, thread persistence, search, branch/fork.
- `permission-modes.md`: what the permission modes mean, how approvals work.
- `artifacts.md`: where generated files, patches, links, and summaries show up.
- `local-first-memory.md`: local memory, suggestions, correction, archive/delete, where it is stored.

Acceptance:

- A user understands that Openwork/Jingle is a local desktop agent workspace, not a stateless chatbot.

### Agent Workflows

Goal: describe high-frequency task flows.

Required pages:

- `start-from-launcher.md`: open AI from launcher, submit or route.
- `use-files-and-mentions.md`: attach files, mention workspace files, use extension sources.
- `review-approvals.md`: read approval cards, approve/reject, inspect command side effects.
- `stop-resume-and-fork.md`: stop a run, resume after HITL, fork safely.
- `inspect-results.md`: read messages, activity, tool calls, artifacts, diffs.

Acceptance:

- A user can safely delegate a task and recover when it pauses, fails, or asks for approval.

### Extensions

Goal: explain built-in and installable first-party extensions from the user view.

Required pages:

- `overview.md`: what extensions are, how they appear in launcher and AI.
- `todo-list.md`: local todos.
- `translate.md`: model-backed translation.
- `image-generation.md`: API key/base URL, generate/edit images, artifacts.
- `apple-reminders.md`: macOS-only, local Reminders, permissions, menu bar.
- `github.md`: OAuth, issues/PRs/repos/notifications/workflows, AI tools.
- `notion.md`: OAuth/internal access, shared pages/data sources, quick capture.
- `figma-files.md`: OAuth, team IDs, open targets, menu bar.
- `quicklinks.md`: create and manage command quicklinks.

Acceptance:

- Every first-party extension has a setup path, user-visible entry, and troubleshooting pointer.

### Settings / Models

Goal: make the Settings window understandable.

Required pages:

- `settings-overview.md`: map settings tabs to tasks.
- `model-providers.md`: supported provider types, credentials, remote model list, default model.
- `memory-settings.md`: turn memory on/off, review suggestions, show included memories.
- `appearance.md`: theme, accent, font, contrast.
- `shortcuts.md`: global launcher shortcut, conflicts, reset.

Acceptance:

- A user can configure models and app behavior without guessing which tab owns what.

### Troubleshooting

Goal: fix common failures before support escalation.

Required pages:

- `model-setup.md`: missing key, invalid key, no supported chat models, local registry.
- `workspace-and-files.md`: no workspace, inaccessible path, wrong workspace.
- `approvals-and-permissions.md`: pending approvals, rejected tools, command safety.
- `extension-connections.md`: OAuth callback, missing connection, token renewal.
- `apple-reminders.md`: macOS Reminders permissions and helper errors.
- `shortcuts.md`: global shortcut unavailable.
- `packaging-installation.md`: unsigned mac dev builds, Windows/Linux package notes.

Acceptance:

- Most support requests can link to one troubleshooting page plus logs instructions.

### Logs And Diagnostics

Goal: let users and support find observable failure signals.

Required pages:

- `find-logs.md`: where logs live under `OPENWORK_HOME/logs`, what `openwork.log` contains.
- `share-a-diagnostic-report.md`: what to include, what to redact.
- `electron-debugging-for-support.md`: when support asks for CDP/DevTools, link to dev doc.

Acceptance:

- Users can attach useful diagnostics without exposing secrets or entire workspaces.

### FAQ

Initial questions:

- Is Openwork/Jingle local-first?
- What can the agent read or change?
- Where are model keys stored?
- Why do I need to approve a command?
- How do I stop or recover a run?
- How do I delete memory?
- Which extensions require OAuth?
- Where are logs?
- What is the difference between the launcher and the history window?
- What is the difference between npm package and desktop app release?

## First Help Pages To Write

Wave 2 should start with these pages because they unblock the release acceptance
criteria fastest:

1. `docs/help/README.md`
2. `docs/help/getting-started/install-and-open.md`
3. `docs/help/getting-started/first-agent-run.md`
4. `docs/help/getting-started/configure-a-model.md`
5. `docs/help/core-concepts/workspace.md`
6. `docs/help/core-concepts/permission-modes.md`
7. `docs/help/extensions/overview.md`
8. `docs/help/logs-and-diagnostics/find-logs.md`
9. `docs/help/faq.md`
