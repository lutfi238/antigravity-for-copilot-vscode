# Changelog

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
