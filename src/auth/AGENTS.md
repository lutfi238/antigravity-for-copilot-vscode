# Authentication

## Purpose

- Own Google OAuth sign-in, secure multi-account persistence, access-token refresh, and billing-project resolution.

## Ownership

- `oauth.ts` runs PKCE authorization, the loopback callback, token exchange/refresh, and userinfo lookup.
- `store.ts` persists refresh-token-bearing account records in VS Code `SecretStorage` and the active email in global state.
- `tokens.ts` caches access tokens in memory and single-flights refreshes per account.
- `project.ts` resolves and caches the Cloud Code project used by gateway requests.

## Local Contracts

- The OAuth redirect is fixed at `http://localhost:51121/oauth-callback`; never make port `51121` dynamic.
- Bind the callback listener to loopback, validate OAuth state, honor cancellation, close the server, and fail clearly when the port is occupied.
- Persist refresh tokens only in `SecretStorage`; access tokens stay in memory. Preserve rotated refresh tokens.
- Refresh access tokens five minutes before expiry and single-flight concurrent refreshes per account.
- Account changes must notify listeners so models and UI refresh.
- Resolve project ids in this order: explicit setting, cached account value, `loadCodeAssist`, `onboardUser`, then the documented fallback.

## Work Guidance

- Keep sign-out scoped to this extension's stored account data.
- Never log authorization codes, tokens, client credentials, or full unredacted OAuth responses.

## Verification

- `npm run typecheck`
- OAuth, SecretStorage, refresh rotation, and project discovery require Extension Development Host testing; the unit suite does not currently cover this folder directly.

## Child DOX Index

- No child AGENTS.md files are needed; this folder is one credential lifecycle boundary.
