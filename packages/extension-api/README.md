# @jingle/extension-api

Jingle extension author API.

This package is the public boundary that bundled and future installable extensions should import.
It owns the extension SDK implementation and public extension contracts; extension packages should
not import renderer, main, preload, shared, or registry internals directly.

`@jingle/extension-api/host-runtime` is a host-only subpath for Jingle's runtime renderer and
tests. Extension packages should use the root `@jingle/extension-api` entry.

`AI.ask` accepts a prompt string for the platform default model policy, or an object with `prompt`,
required `modelPreference: "fast"`, optional `system`, and optional `temperature` from `0` to `2`.
Prompts are limited to 200,000 characters and system instructions to 40,000 characters. The host
owns concrete provider, model, and reasoning-effort selection; extensions cannot send a raw
`modelId`. Rebuild older runtime artifacts against the current SDK if the host returns
`extension_ai_request_invalid`.
