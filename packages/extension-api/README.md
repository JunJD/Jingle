# @jingle/extension-api

Jingle extension author API.

This package is the public boundary that bundled and future installable extensions should import.
It owns the extension SDK implementation and public extension contracts; extension packages should
not import renderer, main, preload, shared, or registry internals directly.

`@jingle/extension-api/host-runtime` is a host-only subpath for Jingle's runtime renderer and
tests. Extension packages should use the root `@jingle/extension-api` entry.
