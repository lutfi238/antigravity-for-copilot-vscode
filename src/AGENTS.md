# Source

## Purpose

- Own the extension runtime and coordinate the API, authentication, translation, and UI domains.

## Ownership

- `extension.ts` constructs shared services, registers the provider and commands, and binds disposables to the extension context.
- `provider.ts` is the orchestration seam from model discovery and request translation through gateway streaming and VS Code response parts.
- `config.ts` reads `antigravity.*` settings and identifies changes that require provider refresh.
- `log.ts` owns structured operation logging and secret/error redaction.
- `timing.ts` records generation phase milestones and terminal summaries using monotonic time and fixed phase names.
- `agyCli.ts` runs the optional local `agy` sidecar for native web-search requests and parses its machine-readable stream.
- `webSearch.ts` registers the `antigravity_web_search` VS Code tool marker and returns grounded search results to Copilot.
- `agyImage.ts` runs the optional local `agy` sidecar for native image generation, validates bounded raster artifacts, and keeps artifact paths inside Antigravity's brain directories.
- `imageGeneration.ts` registers the `antigravity_generate_image` VS Code tool marker and returns inline image data parts to Copilot.
- `imageArtifacts.ts` persists validated returned raster bytes in extension storage, creates local preview references, and identifies the extension's own artifacts for final-answer display.

## Local Contracts

- Register the provider under vendor id `antigravity`; keep command ids synchronized with `package.json`.
- Route protocol-specific transformations through `translate/`, transport/discovery through `api/`, credentials through `auth/`, and user interaction through `ui/`.
- Maintain cancellation across VS Code requests, fetch calls, retry delays, and stream consumption.
- Keep optional `agy` sidecars bounded: one native search call, or one built-in `image-generator` delegation (legacy direct `generate_image` supported). Pass arguments without a shell, reject unexpected parent tools/delegates, and never expose their stderr or credentials to chat.
- For image generation, validate raster magic bytes and size limits, resolve artifact paths through `realpath`, and allow only Antigravity-owned brain directories.
- Preview copies may be written only from already validated image bytes into extension-owned storage. Never read an arbitrary model-supplied path to create a preview. Final-answer previews must match known generated references in the current turn; preserve tool output when preview storage fails.
- When Agy omits `output_path`, recover only recent raster files under the stream's validated parent `conversation_id` or child ID explicitly linked to the verified `image-generator`; never scan the whole user home or unrelated sessions.
- Do not force the Agy terminal `--sandbox` flag from the extension. Preserve the CLI's permission behavior, confine the requested image route, validate completed execution, and retain VS Code confirmation without adding auto-approval flags.
- Never log prompts, reasoning text, tool arguments/results, access tokens, refresh tokens, or OAuth credentials.
- Log values a human can read: render enums by name (`toolMode=auto`, not the raw `1`) and omit `undefined` fields instead of printing `k=undefined`, so absence stays distinguishable from a real `0`.
- Feature-detect VS Code runtime APIs that are newer than or absent from `@types/vscode`.

## Work Guidance

- Keep `provider.ts` focused on orchestration; place domain rules in the owning child module.
- Use one operation id across each logical discovery, authentication, or generation flow so fallback and retry logs correlate.
- Keep provider response completion responsible for forwarding gateway usage metadata to VS Code's context-window accounting.
- Gemini quota-summary metadata must not delay the model picker. Capture the account and refresh revision for background updates, invalidate the service on refresh/account changes, and discard late results after provider disposal.

## Verification

- Run `npm run typecheck` after source edits.
- Run the relevant Vitest files for local changes, then `npm run check` before completion when credentials are available.

## Child DOX Index

- [`api/AGENTS.md`](api/AGENTS.md) — gateway transport, endpoints, envelopes, model catalogue, errors, and SSE.
- [`auth/AGENTS.md`](auth/AGENTS.md) — OAuth, account persistence, token lifecycle, and project resolution.
- [`translate/AGENTS.md`](translate/AGENTS.md) — VS Code/Gemini message conversion, tool schemas, reasoning, and streamed output.
- [`ui/AGENTS.md`](ui/AGENTS.md) — account management QuickPick and quota status bar.
