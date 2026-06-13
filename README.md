# openwork

[![npm][npm-badge]][npm-url] [![License: MIT][license-badge]][license-url]

[npm-badge]: https://img.shields.io/npm/v/openwork.svg
[npm-url]: https://www.npmjs.com/package/openwork
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT

A harness-first desktop agent for non-programmers, built on [deepagentsjs](https://github.com/langchain-ai/deepagentsjs), with controlled execution, approvals, and persistent run visibility.

[中文 README](README-cn.md)

> [!CAUTION]
> openwork gives AI agents direct access to your filesystem and the ability to execute shell commands. Always review tool calls before approving them, and only run in workspaces you trust.

## Get Started

```bash
# Run directly with npx
npx openwork

# Or install globally
npm install -g openwork
openwork
```

Requires Node.js 18+.

After the app opens, configure a model provider from Settings -> Models before
starting an agent run.

### From Source

```bash
git clone https://github.com/langchain-ai/openwork.git
cd openwork
pnpm install
pnpm run dev
```

Source development uses pnpm. The dev script builds the bundled installable
extensions before starting Electron.

## Documentation

- [Docs index](docs/README.md)
- [中文文档索引](docs/README-cn.md)
- [User help center](docs/help/README.md)
- [Developer guide](docs/dev/README.md)
- [Production readiness governance](docs/production-readiness/README.md)
- [Electron debugging](docs/openwork-electron-debugging.md)

## Desktop Release

Desktop packaging is handled by
[Desktop Release](.github/workflows/desktop-release.yml). It runs on tag pushes
and can also be started manually from GitHub Actions. The current packaging
matrix builds macOS, Windows, and Linux artifacts.

Pushing a release tag publishes a GitHub Release with the generated desktop
assets:

```bash
git tag v1.2.3
git push origin v1.2.3
```

Release tags should use either `v1.2.3` or `app-v1.2.3`. The desktop workflow
strips the `v` / `app-v` prefix and uses `1.2.3` as the app version.
Prerelease tags such as `v1.2.3-beta.1` are marked as prereleases.

The separate [Release](.github/workflows/release.yml) workflow publishes the npm
package on `v*` tags. A `v*` tag currently triggers both npm publishing and
desktop packaging; an `app-v*` tag is for desktop packaging without npm publish.

To package locally:

```bash
pnpm run dist:mac
pnpm run dist:mac:dir
pnpm run dist:win
pnpm run dist:linux
```

macOS dev preview builds may be unsigned or not notarized. See [docs/macos-dev-preview-install.md](docs/macos-dev-preview-install.md) for the tester install guide.

## Validation

Core checks:

```bash
pnpm run doctor
pnpm run check:guardrails
pnpm run check:extensions
pnpm run typecheck
pnpm run test:node
```

The repository also includes an Electron BDD harness built on Cucumber and
Playwright:

```bash
pnpm run test:bdd:smoke
pnpm run test:bdd
```

The BDD runner builds the app first, launches the packaged Electron entrypoint,
creates an isolated `OPENWORK_HOME` temp directory for each scenario, and applies
Prisma migrations before the app starts.

See [docs/dev/validation-matrix.md](docs/dev/validation-matrix.md) for the
full quality-gate map and [docs/dev/release-runbook.md](docs/dev/release-runbook.md)
for packaging and release verification.

## Model Providers

Openwork/Jingle supports configured cloud providers, local model registries, and
custom OpenAI-compatible endpoints through Settings -> Models. Use the in-app
model list as the current source of truth for available models.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Report bugs via [GitHub Issues](https://github.com/langchain-ai/openwork/issues).

## License

MIT — see [LICENSE](LICENSE) for details.
