# Gateway API

## Purpose

- Own HTTP transport and the Antigravity gateway contracts used for discovery and generation.

## Ownership

- `client.ts`, `http.ts`, and `errors.ts` own authenticated fetches, proxy handling, retries/fallback, redaction, and VS Code error mapping.
- `constants.ts` owns endpoint order, OAuth/gateway constants, user agent, and bootstrap metadata.
- `agent-metadata.ts` owns session identifiers, request metadata/envelopes, and client-compatible field ordering.
- `models.ts` and `modelInfo.ts` own catalogue parsing, curation, effort tiers, quota buckets, and picker metadata.
- `stream.ts` owns incremental SSE framing and JSON event parsing.
- `credentials.example.ts` documents the required local OAuth credential module; `credentials.ts` is ignored and private.

## Local Contracts

- Generation and discovery fallback order is daily then production; the production model catalogue can lag behind the current CLI.
- Keep the `User-Agent` fingerprint aligned with the locally verified Antigravity CLI release when backend model availability changes.
- Keep gateway headers minimal. Do not add spoofed or rotating CLI headers such as `X-Goog-Api-Client`.
- Retry only the transient statuses encoded in the client and honor cancellation during requests and retry delays.
- Preserve the real client's envelope field order, five-segment request id, telemetry labels, and FNV-1a session id.
- Parse `fetchAvailableModels` as a map keyed by model id. Keep fallback models for discovery failure, not as a substitute for malformed successful data.
- Default model curation is a rolling window of three Gemini generations per line, excluding Flash Lite and internal Tab/Chat/image/tiered aliases; `all` bypasses curation. Keep the fallback roster synchronized with CLI-visible current models.
- Keep quota groups separate for Gemini Pro, Gemini Flash, and Claude/GPT.
- SSE parsing must tolerate arbitrary chunk boundaries, CRLF/LF separators, multi-line `data:` fields, `[DONE]`, and a final unterminated event.

## Work Guidance

- Back changes to model parsing, curation, metadata, errors, or SSE behavior with focused tests.
- Do not expose local OAuth values in logs, fixtures, docs, or patches.

## Verification

- `npm test -- test/envelope.test.ts test/modelinfo.test.ts test/models.test.ts test/stream.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child AGENTS.md files are needed; this folder is one transport/discovery boundary.
