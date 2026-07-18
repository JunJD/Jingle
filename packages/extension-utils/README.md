# @jingle/extension-utils

Jingle extension author utilities.

This package is the target for migrated utility imports that are not host-private APIs. It starts
with the hooks Notion UI commands need first: `useCachedPromise`, `usePromise`,
`useFetch`, `useLocalStorage`, `useForm`, and `FormValidation`, plus the minimal
`OAuthService` / `withAccessToken` bridge used by migrated Notion code.

`useFetch` covers the migration-critical Raycast utility surface first: JSON/text parsing,
`mapResult`, pagination URL loaders, `initialData`, lifecycle callbacks, optimistic `mutate`,
and default failure toasts through the runtime toast capability.

## Promise hook cache contract

`usePromise` owns request lifecycle, cancellation, pagination, and in-memory replacement. It does
not read or write persistent cache state.

`useCachedPromise` adds extension-scoped, durable stale-while-revalidate behavior:

- A cache hit is returned immediately and revalidated in the background. `keepPreviousData`
  applies only when the new identity has no cache entry.
- The namespace is derived from the promise function source and the entry key is derived from its
  explicit arguments. Values captured only in a closure are not part of the identity; callers must
  pass every input that changes the resource or projection in `args`.
- Canonical arguments distinguish `undefined`, `null`, `NaN`, infinities, `-0`, `Date`, `URL`,
  function source, array holes, and object key order. Circular values, symbols, weak collections,
  promises, maps, sets, typed arrays, bound/native functions, and unsupported class instances fail
  identity construction explicitly.
- Cache entries use a strict, versioned JSON envelope. Values are limited to plain JSON trees, plus
  an explicit root `undefined` variant; lossy values such as `Date`, `Map`, custom `toJSON`, sparse
  arrays, non-finite numbers, and `-0` are rejected. Encoding and capacity failures keep the fresh
  request data visible and show a bounded cache warning. A binding starts with a stable miss and does
  not read the backend during render. Its subscription registers first, then reads the exact durable
  snapshot at commit; invalid envelopes are discarded there and revalidated as misses. Backend read,
  subscription, and persistence failures remain fatal runtime facts instead of being downgraded to
  cache misses.
- Only page zero and its cursor are persisted. Additional pages stay in the hook state and are
  discarded when another hook publishes a newer page-zero snapshot.
- `execute: false` still allows a cache read and always reports `isLoading: false`. It disables the
  automatic request and load-more path. Calling `revalidate()` is an explicit manual request and
  therefore runs even while `execute` is false.
- `mutate` defaults to revalidation, supports optimistic data, restores the exact pre-mutation value
  on default rollback, and ignores late work after an identity, request, mutation, or mount change.

`useFetch` uses the same cache and mutation owner. Its durable identity includes either the static
URL or the functional URL source, plus normalized request options, `mapResult`, `parseResponse`, and
explicit `dependencies`. Functional URLs must provide this option at the type boundary; use `[]`
only when the function has no resource-changing closure state. Closure values that change a
functional URL or projection must be passed in `dependencies`; changing one creates a new durable
address and automatically executes the new request. URL functions run only when a request executes,
never during render. Request objects with bodies and body types that cannot be represented
canonically are rejected instead of sharing an ambiguous cache entry.

The cache has no TTL and does not deduplicate simultaneous requests. A binding subscribes before
reading its exact key, so writes between construction and subscription cannot be missed. Backend
reads and in-memory recency updates begin only at subscription commit, never during render. The
atomic file backend serializes mutation across utility processes, while live subscription delivery
remains process-local; a newly started utility reads the latest durable snapshot. Callers must not
use this cache as authoritative business state.
