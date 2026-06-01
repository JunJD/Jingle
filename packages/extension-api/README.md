# @openwork/extension-api

Openwork extension author API.

This package is the public boundary that bundled and future installable extensions should import.
It owns the extension SDK implementation and public extension contracts; extension packages should
not import renderer, main, preload, shared, or registry internals directly.

`@openwork/extension-api/host-runtime` is a host-only subpath for Openwork's runtime renderer and
tests. Extension packages should use the root `@openwork/extension-api` entry.
