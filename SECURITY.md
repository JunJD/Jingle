# Security Policy

Jingle is a local desktop agent that can read files, run tools, call extension
APIs, and execute shell commands with user approval. Treat security reports as
high priority.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Public prerelease | Yes |

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Use GitHub private vulnerability reporting once it is enabled for this
repository. Until then, open a minimal public issue asking for a secure contact
without including exploit details.

Include:

- affected version or commit
- operating system
- steps to reproduce
- impact
- any suggested fix or mitigation

## Scope

This policy covers:

- the Jingle desktop application
- the `jingle` npm package once published
- Jingle extension SDK packages
- bundled installable extensions
- local storage, approval, shell execution, and filesystem access boundaries

Out of scope:

- third-party dependencies, unless Jingle uses them unsafely
- LLM provider APIs
- social engineering
- reports that require disabling the documented approval model without another
  vulnerability

## User Safety Guidance

- Run Jingle only in workspaces you trust.
- Review tool calls before approving them.
- Keep API keys in Jingle's configured secret storage or environment variables.
- Do not grant broad filesystem access to private directories unless needed.
- Keep desktop builds updated once public releases start.
