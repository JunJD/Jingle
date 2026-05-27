# @openwork/extension-api

Openwork extension author API.

This package is the public boundary that bundled and future installable extensions should import.
It currently forwards to the in-repo runtime implementation, but extension packages should not import
renderer, main, preload, shared, or registry internals directly.
