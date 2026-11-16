# Gateway API

## Purpose

- Own HTTP transport and the Antigravity gateway contracts used for discovery and generation.

## Ownership

- `client.ts`, `http.ts`, and `errors.ts` own authenticated fetches, proxy handling, retries/fallback, redaction, and VS Code error mapping.
- `constants.ts` owns endpoint order, OAuth/gateway constants, user agent, and bootstrap metadata.
- `agent-metadata.ts` owns session identifiers, request metadata/envelopes, and client-compatible field ordering.
- `models.ts` and `modelInfo.ts` own catalogue parsing, curation, effort tiers, quota buckets, and picker metadata.
- `accountPlan.ts` reads authenticated account tier metadata for display, with a bounded background lookup and per-account cache; never infer a subscription from quota, model availability, or upgrade offers.
- `geminiQuota.ts` reads standard Gemini's explicit `gemini-5h`/`5h` and `gemini-weekly`/`weekly` buckets from `retrieveUserQuotaSummary`. Keep this optional lookup account-bound, background-only, cached for one minute and bounded at five seconds; never reuse these buckets for Argon or Claude/GPT, infer periods from dates, or turn missing/disabled data into 100%.
- Account credits come from the selected tier's `availableCredits` entries of type `GOOGLE_ONE_AI`; sum valid int64 string amounts exactly, keep missing/malformed balances unknown, and never substitute quota percentages or offer-tier credits.
- `stream.ts` owns incremental SSE framing and JSON event parsing.
- `cancellation.ts` stops a caller's wait on shared project/token work without aborting other consumers.
- `credentials.example.ts` documents the required local OAuth credential module; `credentials.ts` is ignored and private.

## Local Contracts

- Generation and discovery fallback order is daily then production; the production model catalogue can lag behind the current CLI.
- Keep the `User-Agent` fingerprint aligned with the locally verified Antigravity CLI release when backend model availability changes. Bump the version and its `cl` changelist together, and cite where each value came from: the `cl` value is the `google_src/files/<CL>` build id embedded in the release binary, not a guess. Never raise the fingerprint on a contributor report alone, because it changes the identity sent to an undocumented endpoint.
- Keep gateway headers minimal. Do not add spoofed or rotating CLI headers such as `X-Goog-Api-Client`.
- Retry only the transient statuses encoded in the client and honor cancellation during requests and retry delays.
- Bind account metadata requests and their token-refresh retries to the captured account. Never serialize account credentials into request bodies or logs.
- Preserve the real client's envelope field order, five-segment request id, telemetry labels, and FNV-1a session id.
- Parse `fetchAvailableModels` as a map keyed by model id. Keep fallback models for discovery failure, not as a substitute for malformed successful data.
- Default model curation keeps only the newest discovered Gemini generation per line and all its effort tiers, excluding Flash Lite and internal Tab/Chat/image/tiered/worker/disabled aliases, plus entries the gateway marks `disabled: true`. New product lines pass through discovery. `all` bypasses generation/Flash Lite filtering but still deduplicates and excludes non-chat aliases. Keep the fallback roster synchronized with CLI-visible current models; never add unavailable preview placeholders or guessed IDs.
- Effort tiers are `low`, `medium`, `high`, `xhigh` (`ThinkingTier`). A collapsed entry is represented by its `high` sibling even when it publishes `xhigh`, so an unset effort never upgrades to the most expensive tier; a request for a tier the group does not publish falls back along `resolveTier`'s order instead of emitting an unroutable id. Numeric-budget models (Claude) never offer `xhigh`.
- The tier must be derived from the model id, not only from the display name. Discovery sometimes sends the same bare name ("Gemini 4 Hydrogen") for every tier; `collapseTiers` and `curateModels` both fall back to `tierOf(id)` so those siblings are neither deduped away nor left without a Thinking Effort control. Dedupe keys on `baseName(name) + tier` so genuinely duplicate names still collapse to one row. Keep a regression test for the bare-name payload shape.
- Display standard Gemini, discovered Gemini Argon, and Claude/GPT as separate quota groups. Identify Argon only within Gemini entries; do not infer quota-pool independence or weekly limits from model names. When per-model fractions differ, retain the lowest reported fraction; never add or average quota percentages.
- SSE parsing must tolerate arbitrary chunk boundaries, CRLF/LF separators, multi-line `data:` fields, `[DONE]`, and a final unterminated event.

## Work Guidance

- Back changes to model parsing, curation, metadata, errors, or SSE behavior with focused tests.
- Do not expose local OAuth values in logs, fixtures, docs, or patches.

## Verification

- `npm test -- test/envelope.test.ts test/modelinfo.test.ts test/models.test.ts test/stream.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child AGENTS.md files are needed; this folder is one transport/discovery boundary.
