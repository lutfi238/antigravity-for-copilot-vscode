# Changelog

## 0.12.0

- Match the picker to Antigravity own model list. Flash Lite is a line the backend can
  route to but that Antigravity never offers as a choice, so it no longer appears;
  `modelSelection: all` still includes it.


## 0.11.0

- Rewrite tool-schema sanitization against the contract the shipping client uses. Two
  validators run in series and both must pass: the gateway parses `parameters` with
  protobuf JSON and rejects any unknown key, then Claude requests are forwarded to
  Anthropic, which validates JSON Schema draft 2020-12.
- Types are now lowercase for every model. Uppercase proto enum names happened to pass
  the gateway but are exactly what Anthropic rejects; the 0.10.0 dialect split traded
  one failure for the other.
- Dropped constraints (`pattern`, `minLength`, `format`, ...) are folded into the
  description instead of vanishing, so the model still knows about them.
- Empty object schemas gain a placeholder property, which Claude validated tool mode
  requires.

## 0.10.0

- Fix Claude and GPT-OSS failing every request with "input_schema: JSON schema is
  invalid. It must match JSON Schema draft 2020-12". The gateway speaks Gemini wire
  format for all models but does not validate tool schemas itself: Gemini goes to a
  protobuf validator that demands uppercase type enums, while Claude is forwarded to
  Anthropic, which requires real JSON Schema and rejects those same uppercase types.
  Schemas are now sanitized per model family.
- Property names are no longer filtered as if they were keywords, so a tool parameter
  called `tags`, `scope` or `order` survives.

## 0.9.0

- Fix the Thinking Effort control never taking effect. VS Code delivers the model
  pickers `configurationSchema` selection on `options.modelConfiguration`, a field
  `@types/vscode` does not declare; `modelOptions` carries only its own internal keys
  (`_conversationId`, `_enableThinking`, ...). Reading only `modelOptions` meant every
  request silently fell back to `antigravity.reasoningEffort`, so picking High or Low
  still sent `gemini-3.7-flash-medium`.
- The effort is now read from `modelConfiguration`, `modelOptions` and `configuration`,
  tolerating the alternate key shapes, and the log names which channel supplied it.

## 0.8.1

- Log how the thinking effort was resolved: `effort`, `effortFrom=picker|setting`,
  `modelOptionKeys` and `thoughtsRequested`. Without these there is no way to tell a
  picker selection that never arrives from one that arrives and is honoured.

## 0.8.0

- Show reasoning in Copilot Chat's own collapsible **Thinking…** block.
  `LanguageModelThinkingPart` exists in the VS Code runtime but is not declared in
  `@types/vscode`; it is now feature-detected, with the previous markdown blockquote
  kept as the fallback for builds that lack it. Streamed reasoning chunks share one id
  so they group into a single block.
- `antigravity.showThinking` now defaults to on, since the native block is collapsed
  and does not crowd the answer.

## 0.7.0

- New icon.
- Keep the name "Antigravity Model Bridge". The marketplace rejects any display name containing
  "Antigravity for Copilot", which an extension already uses, so the shorter and longer
  variants of that phrasing are both unavailable.

## 0.6.0

- Rename the extension to "Antigravity For Copilot - Use your Antigravity with VS Code Agent". The plain "Antigravity for Copilot" is already
  taken on the marketplace, so the longer form doubles as the differentiator and says
  what it does.

## 0.5.1

- Correct the listing: `effortSelection` defaults to `setting`, not `tiers`, and
  `reasoningEffort` is the starting value for the picker control rather than the only
  way to set effort.

## 0.5.0

- Add a **Thinking Effort** control next to the model in the picker, via the
  `configurationSchema` field on the model information object. The field is absent from
  `@types/vscode` but the VS Code runtime honours it, and the selection arrives back as
  `modelOptions` on the request — so a third-party provider can offer the same
  per-request effort control Copilot's own models have.
- Only the tiers the backend actually routes are offered: Gemini 3.1 Pro exposes High
  and Low but no Medium, because no such model id exists. Claude takes an arbitrary
  numeric budget, so all three are genuine.
- `antigravity.effortSelection` now defaults to `setting`: one entry per model with the
  effort control, rather than a picker row per tier.
- `antigravity.reasoningEffort` becomes the starting value; a picker selection wins for
  that request.

## 0.4.0

- Add `antigravity.effortSelection`. Antigravity exposes each effort tier as a separate
  model id, so the picker carried one row per tier. Setting this to `setting` folds them
  into a single entry per model and takes the tier from `antigravity.reasoningEffort`,
  cutting the list from 9 entries to 6. The default is unchanged, because the picker is
  the only per-request effort control the VS Code provider API allows.

## 0.3.1

- Rewrite the README, which is also the marketplace listing.
- Keep OAuth client credentials out of version control: `src/api/credentials.ts` is
  git-ignored and generated from a committed template, and the build refuses to run
  without it rather than producing an extension that cannot authenticate.
- Read the extension id from the extension context instead of hardcoding it, so the
  "Open Settings" action survives a publisher rename.

## 0.3.0

- Request and render model reasoning behind `antigravity.showThinking`. Gemini receives
  `thinkingLevel` (recovered from the model id), Claude keeps its numeric budget.
  VS Code exposes no thinking part to third-party providers, so reasoning renders as a
  blockquote rather than a collapsible block.
- Declare `engines.vscode: ^1.108.0` honestly — `LanguageModelDataPart` (image input)
  does not exist before 1.108, and npm had been masking this by resolving `^1.104.0`
  to a much newer types package.

## 0.2.0

- Curate the discovered catalogue. Antigravity lists every routable model, including
  `Tab_*` autocomplete models, `Chat_NNNNN` internal aliases, `*tiered*` routing
  aliases, image models, duplicate display names, and every past generation.
  Default `latest` keeps only the newest generation of each Gemini line; set
  `antigravity.modelSelection` to `all` to opt out. 27 models becomes 9.

## 0.1.1

- Replace the schema denylist with an allowlist of the 19 fields the gateway's `Schema`
  proto defines. The gateway parses with protobuf JSON and hard-fails on any unknown
  key, so one VS Code extension keyword (`enumDescriptions`) anywhere in a 40-tool
  payload failed the whole request.
- Stringify non-string enum members, map `type: [T, "null"]` to `nullable`, and infer
  `STRING` for a bare `enum`.

## 0.1.0

- Correct the wire protocol against the shipping client: the daily host is
  `daily-cloudcode-pa.googleapis.com` (not the `.sandbox.` variant), the User-Agent is
  the Antigravity CLI identity, and content requests send no `X-Goog-Api-Client`,
  `Client-Metadata` or `Accept` header.
- Send the agent request envelope: `requestType`, a five-segment `requestId`, telemetry
  `labels`, and an FNV-1a session id, in the field order the client emits.
- Use the real model ids, including the irregular `gemini-pro-agent` and
  `gemini-3-flash-agent` top tiers.

## 0.0.2

- Parse `fetchAvailableModels` as a map keyed by model id rather than an array. The
  mismatch threw, was swallowed, and silently substituted a stale hardcoded roster with
  no quota — which looked identical to an account with no access.
- Split quota into three buckets (Gemini Pro, Gemini Flash, Claude/GPT); Flash refills
  far faster than Pro.
- Stop sending numeric thinking budgets to Gemini, which takes a level string.

## 0.0.1

- Initial Language Model Provider registration, OAuth sign-in, and streaming.
