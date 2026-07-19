# Support

Jingle support is community-first. The project is in active development, so
clear reproduction steps and environment details matter more than polished bug
reports.

## Where To Ask

- Bugs: open a GitHub issue with reproduction steps, logs, OS, Jingle version or
  commit, and installation method.
- Feature requests: use the feature request template and describe the workflow,
  not only the desired UI.
- Security issues: follow [SECURITY.md](SECURITY.md). Do not post exploit
  details in a public issue.
- General setup questions: start with [README.md](README.md) and
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Useful Details

For desktop or agent-runtime bugs, include:

- operating system and architecture
- Jingle commit or release
- whether you ran from source or a packaged build
- the command or workflow that failed
- relevant terminal output, app logs, or screenshots
- whether the issue involves shell execution, filesystem access, approvals,
  checkpoints, memory, or an extension

For an unexpected desktop exit, follow the dedicated
[Electron crash response guide](docs/electron-crash-response.md). It explains
how to record the exact incident time, select a matching macOS `.ips` report,
and provide Jingle diagnostics without posting an entire log directory or
`JINGLE_HOME` publicly.

## Maintenance Expectations

Maintainers may close issues that cannot be reproduced, are missing required
context, or are outside the current roadmap. Valid bugs and project direction
requests can be reopened when new evidence is available.
