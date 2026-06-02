# @openwork/extension-utils

Openwork extension author utilities.

This package is the target for migrated utility imports that are not host-private APIs. It starts
with the hooks Notion UI commands need first: `useCachedPromise`, `usePromise`,
`useFetch`, `useLocalStorage`, `useForm`, and `FormValidation`, plus the minimal
`OAuthService` / `withAccessToken` bridge used by migrated Notion code.

`useFetch` covers the migration-critical Raycast utility surface first: JSON/text parsing,
`mapResult`, pagination URL loaders, `initialData`, lifecycle callbacks, optimistic `mutate`,
and default failure toasts through the runtime toast capability.
