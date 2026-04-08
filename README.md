# openwork

[![npm][npm-badge]][npm-url] [![License: MIT][license-badge]][license-url]

[npm-badge]: https://img.shields.io/npm/v/openwork.svg
[npm-url]: https://www.npmjs.com/package/openwork
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT

A harness-first desktop agent for non-programmers, built on [deepagentsjs](https://github.com/langchain-ai/deepagentsjs), with controlled execution, approvals, and persistent run visibility.

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

### From Source

```bash
git clone https://github.com/langchain-ai/openwork.git
cd openwork
npm install
npm run dev
```

Or configure them in-app via the settings panel.

## Electron Debugging

For CDP-based debugging against the real Electron window, see [docs/openwork-electron-debugging.md](docs/openwork-electron-debugging.md).

## BDD Testing

The repository now includes a minimal Electron BDD harness built on Cucumber and Playwright.

```bash
npm run test:bdd:smoke
npm run test:bdd
```

The BDD runner builds the app first, launches the packaged Electron entrypoint, creates an isolated `OPENWORK_HOME` temp directory for each scenario, and applies Prisma migrations before the app starts.

## Supported Models

| Provider  | Models                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Anthropic | Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.1, Claude Sonnet 4                |
| OpenAI    | GPT-5.2, GPT-5.1, o3, o3 Mini, o4 Mini, o1, GPT-4.1, GPT-4o                                           |
| Google    | Gemini 3 Pro Preview, Gemini 3 Flash Preview, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Report bugs via [GitHub Issues](https://github.com/langchain-ai/openwork/issues).

## License

MIT — see [LICENSE](LICENSE) for details.
