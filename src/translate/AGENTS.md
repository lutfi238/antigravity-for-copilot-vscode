# Protocol Translation

## Purpose

- Translate between VS Code Language Model Chat objects and the Gemini-shaped wire protocol used by every Antigravity model family.

## Ownership

- `toGemini.ts` converts ordered messages, tools, results, images, model options, and reasoning settings into requests.
- `fromGemini.ts` converts streamed candidates into VS Code text, thinking, tool-call, and private usage parts while recording signatures and usage.
- `schema.ts` normalizes tool schemas and maintains reversible tool-name mappings.
- `thinking.ts` owns model-specific reasoning configuration and the bounded in-memory thought-signature cache.
- `types.ts` defines the minimal wire shapes and shared response-part MIME contract used by translation and API code.

## Local Contracts

- Always send Gemini `contents[]` envelopes, including for Claude and GPT-OSS; never introduce Anthropic-style `messages` requests.
- Preserve message order. Pair each tool result with the earlier tool call by name, using the ordered `callId` to sanitized-name map.
- Synthesize globally unique tool-call ids for every emitted Gemini function call; VS Code uses them to correlate permissions and results across provider responses.
- Gateway tool names must match `^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$`; sanitization must remain reversible and collision-safe within a request.
- Tool schemas pass two validators. Remove unsupported protobuf fields and recursive `x-*` vendor metadata (including `x-mcp-*`), keep lowercase JSON Schema types, retain property names verbatim, convert `const` to one-value `enum`, preserve dropped constraints as description hints, and fill empty object schemas for Claude.
- Replay Gemini thought signatures across turns. VS Code history cannot store them, so cache by tool call id or stable assistant-text key.
- Gemini reasoning effort comes from the tiered model id; only numeric-budget models receive `thinkingBudget`, which must stay strictly below `maxOutputTokens`.
- Prefer native `LanguageModelThinkingPart` when present at runtime and retain the text-blockquote fallback.
- Report completed gateway usage as a `LanguageModelDataPart` with MIME type `usage` and OpenAI-shaped snake_case fields so VS Code's context-window widget can display real usage. Never replay that internal part to Gemini.
- Count Gemini visible candidates and `thoughtsTokenCount` together as completion usage because both consume the context window.

## Work Guidance

- Treat translation as an order-sensitive round trip; test both outgoing payloads and streamed incoming parts when changing shared behavior.
- Extend the minimal types only for observed wire fields used by the implementation.

## Verification

- `npm test -- test/schema.test.ts test/translate.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child AGENTS.md files are needed; these files jointly implement one protocol boundary.
