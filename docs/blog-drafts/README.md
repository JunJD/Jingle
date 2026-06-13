# Blog Drafts

[中文](./README-cn.md)

These drafts are standalone product essays. They should be able to leave the
repository without carrying repo paths, release mechanics, implementation
checklists, or internal evidence links with them.

The shared context is simple:

- a launcher is only the beginning of delegated work;
- agent work needs a visible lifecycle;
- local-first means state and control start on the user's machine;
- extensions should be capabilities with clear boundaries, not hidden coupling;
- diagnostics are part of trust.

## Drafts

| Draft                                                                      | Purpose                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| [product-launch-introduction.md](./product-launch-introduction.md)         | Product introduction                           |
| [launcher-to-agent-workflow.md](./launcher-to-agent-workflow.md)           | Launcher versus delegated workflow             |
| [local-first-agent-workspace.md](./local-first-agent-workspace.md)         | Local workspace and user-owned state           |
| [extension-runtime-design.md](./extension-runtime-design.md)               | Extension capability boundaries for agent work |
| [production-logs-and-diagnostics.md](./production-logs-and-diagnostics.md) | Diagnostics as a product trust surface         |

## Writing Rule

Keep each essay independent. Do not bind an argument to a current file path,
test suite, release artifact, extension list, or internal planning document. If
a detail can drift, either remove it or phrase it as a product principle.
