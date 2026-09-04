# Tests

## Purpose

- Verify deterministic protocol, catalogue, envelope, picker, and SSE behavior without an Extension Development Host.

## Ownership

- `envelope.test.ts` covers session metadata, request ids, FNV-1a values, field order, and outer envelopes.
- `constants.test.ts` covers the Antigravity CLI fingerprint used in gateway headers.
- `modelinfo.test.ts` covers picker configuration schemas and effort-source resolution.
- `provider.test.ts` covers the provider response seam, including SSE consumption, usage-part forwarding, and unique synthesized tool-call ids.
- `models.test.ts` covers discovery parsing, curation, tier collapsing/resolution, quota groups, and fallback models.
- `schema.test.ts` covers schema normalization and tool-name sanitization/mapping.
- `stream.test.ts` covers SSE framing and parsing.
- `translate.test.ts` covers outgoing/incoming translation, tool calls/results, images, signatures, thinking, usage reporting, and finish behavior.
- `agyCli.test.ts` covers native search prompt construction and stream-result validation without starting the CLI.
- `agyImage.test.ts` covers native image prompt construction, stream artifact extraction, session artifact recovery, raster validation, and unexpected-tool rejection without starting the CLI.
- `vscode-stub.ts` supplies the runtime classes/enums required by Vitest; `vitest.config.ts` aliases `vscode` to it.

## Local Contracts

- Tests must be deterministic and offline; do not call Google, Antigravity, or real OAuth endpoints.
- Add focused regression tests for every changed wire quirk or catalogue rule.
- When production code uses a new VS Code runtime class or enum, extend `vscode-stub.ts` with only the behavior needed by tests.
- Assert external contracts and observable payloads rather than private implementation details.

## Work Guidance

- Keep fixtures free of real OAuth credentials, tokens, account identifiers, and prompt data.
- Place a regression near the existing suite for its owning domain rather than creating broad catch-all files.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run check` before completion when local credentials permit bundling.

## Child DOX Index

- No child AGENTS.md files are needed; the test directory is a single verification boundary.
