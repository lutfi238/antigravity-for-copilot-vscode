# Source

## Purpose

- Own the extension runtime and coordinate the API, authentication, translation, and UI domains.

## Ownership

- `extension.ts` constructs shared services, registers the provider and commands, and binds disposables to the extension context.
- `provider.ts` is the orchestration seam from model discovery and request translation through gateway streaming and VS Code response parts.
- `config.ts` reads `antigravity.*` settings and identifies changes that require provider refresh.
- `log.ts` owns structured operation logging and secret/error redaction.

## Local Contracts

- Register the provider under vendor id `antigravity`; keep command ids synchronized with `package.json`.
- Route protocol-specific transformations through `translate/`, transport/discovery through `api/`, credentials through `auth/`, and user interaction through `ui/`.
- Maintain cancellation across VS Code requests, fetch calls, retry delays, and stream consumption.
- Never log prompts, reasoning text, tool arguments/results, access tokens, refresh tokens, or OAuth credentials.
- Feature-detect VS Code runtime APIs that are newer than or absent from `@types/vscode`.

## Work Guidance

- Keep `provider.ts` focused on orchestration; place domain rules in the owning child module.
- Use one operation id across each logical discovery, authentication, or generation flow so fallback and retry logs correlate.

## Verification

- Run `npm run typecheck` after source edits.
- Run the relevant Vitest files for local changes, then `npm run check` before completion when credentials are available.

## Child DOX Index

- [`api/AGENTS.md`](api/AGENTS.md) — gateway transport, endpoints, envelopes, model catalogue, errors, and SSE.
- [`auth/AGENTS.md`](auth/AGENTS.md) — OAuth, account persistence, token lifecycle, and project resolution.
- [`translate/AGENTS.md`](translate/AGENTS.md) — VS Code/Gemini message conversion, tool schemas, reasoning, and streamed output.
- [`ui/AGENTS.md`](ui/AGENTS.md) — account management QuickPick and quota status bar.
