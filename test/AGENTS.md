# Tests

## Purpose

- Verify deterministic protocol, catalogue, envelope, picker, and SSE behavior without an Extension Development Host.

## Ownership

- `envelope.test.ts` covers session metadata, request ids, FNV-1a values, field order, and outer envelopes.
- `constants.test.ts` covers the Antigravity CLI fingerprint used in gateway headers.
- `modelinfo.test.ts` covers picker configuration schemas and effort-source resolution.
- `provider.test.ts` covers the provider response seam, including SSE consumption, usage-part forwarding, and unique synthesized tool-call ids.
- Provider regressions also cover resolved effort payloads, preparation/stream cancellation, and content-free phase timings; `client.test.ts` covers token waits, shared refresh, retries, request summaries, and transport timing.
- `models.test.ts` covers discovery parsing, curation, tier collapsing/resolution, quota groups, and fallback models.
- `statusBar.test.ts` covers grouped quota labels and missing/exhausted quota using a mocked status bar.
- `geminiQuota.test.ts` covers the observed summary bucket IDs/windows, paired resets, absent/disabled/malformed data, Argon/third-party isolation, bounded account-bound lookups, cache expiry and invalidation. Provider/status regressions cover non-blocking loading, both Gemini windows, legacy fallback, and stale-result suppression across account changes/refresh/disposal/sign-out.
- Argon regressions cover isolated quota/reset aggregation, discovered aliases and effort tiers, curation and provider wire limits, absent/exhausted/unknown quota, and removal on account switches. Fixtures do not establish live Argon access or backend pool independence.
- `accountPlan.test.ts` covers actual versus offered tiers, per-account caching, timeout, and invalidation. Provider/client tests cover non-blocking plan loading, account-bound retries, picker counts, and stale-result suppression; status bar tests cover plan updates and separate quota/reset sections.
- Credit regressions cover exact int64 sums, explicit zero versus unknown/malformed balances, tier isolation, cache refresh, and separate status/tooltip display across account switches.
- `schema.test.ts` covers schema normalization and tool-name sanitization/mapping.
- `stream.test.ts` covers SSE framing and parsing.
- `translate.test.ts` covers outgoing/incoming translation, tool calls/results, images, signatures, thinking, usage reporting, and finish behavior, including tool-call id emission and its omission when disabled.
- Tool-guidance regressions cover opt-out, family/tool scoping, preservation of input/history and generation settings, and multiple tool calls with signature replay. Provider tests verify setting propagation and guidance/call-count diagnostics.
- `agyCli.test.ts` covers native search prompt construction, the isolated custom-agent runtime allowlist, spawn arguments/workspace cleanup, and stream-result validation without starting the CLI.
- `agyCliIntegration.test.ts` covers end-to-end integration with a real executable binary without mocks, proving unsupported versions are rejected before any agent turn can start, and proving isolated custom-agent execution and cleanup.
- `agyImage.test.ts` covers native image prompt construction, legacy and image-generator stream evidence, delegated identity/session validation, scoped artifact recovery, raster validation, and failure classification without starting the CLI.
- `imageArtifacts.test.ts` covers persisted preview bytes/URLs, redirected-directory rejection, tool-result reference preservation, and current-turn final-answer previews including duplicates, cancellation, and failures.
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
