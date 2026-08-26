# Antigravity For Copilot - Use your Antigravity with VS Code Agent

A lightweight VS Code Language Model Provider for the Google Antigravity backend.

[![Install](https://img.shields.io/badge/VS_Code-Install-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=lutfi.antigravity-for-copilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Pick **Gemini 3.7 Flash**, **Gemini 3.1 Pro**, **Claude Sonnet 4.6**, **Claude Opus 4.6** or
**GPT-OSS 120B** from the standard model picker and keep using native chat and Agent mode.
Requests run on your Antigravity account rather than Copilot premium requests.

> **Unofficial.** Not affiliated with, endorsed by, or supported by Google. This talks to
> undocumented `v1internal` endpoints, so it can break when Antigravity updates. Use a
> Google account you are willing to risk.

## Highlights

- **Native integration** — the models appear in the standard model picker, in Chat and Agent mode.
- **Automatic model discovery** with a curated default, so the picker shows the newest generation of each line instead of every internal alias.
- **Full tool calling** — built-in, extension and MCP tools are forwarded to the backend, with schemas rewritten to survive its strict validator.
- **Multi-turn reasoning continuity** — thought signatures are replayed so tool-using conversations survive past the first turn.
- **Separate quota buckets** in the status bar: Gemini Pro, Gemini Flash, and Claude/GPT refill on different clocks.
- **Thinking Effort control** in the picker, next to the model, offering only the tiers the backend can serve.
- **Multiple accounts**, switched manually.

Tool execution, confirmation, workspace trust and permissions remain handled by VS Code.

## Get started

1. Install the extension.
2. Run **`Antigravity: Sign in with Google`** from the Command Palette. A browser opens and the
   callback returns to `http://localhost:51121/oauth-callback`.
   - The port is **not** configurable — it is the redirect URI registered with the OAuth client,
     and Google rejects any other. If it is busy, close whatever holds it and retry.
3. Open Chat and pick an Antigravity model from the model picker.

Credentials live in VS Code SecretStorage and refresh automatically, including refresh-token
rotation. Signing out removes only this extension's copy.

## Model selection

Discovery returns every model the backend can route to, including inline-autocomplete models
(`Tab_*`), internal numeric aliases (`Chat_20706`), server-side routing aliases (`*tiered*`),
image models, duplicate display names, and every past generation — 27 entries in practice.

The default `latest` trims that to the newest generation of each Gemini line, de-duplicated.
Set `antigravity.modelSelection` to `all` to see everything, or list ids in
`antigravity.hiddenModels` to remove specific entries.

### Effort tiers

Antigravity addresses each effort tier as its own model id, so discovery reports
"Gemini 3.7 Flash (High)", "(Medium)" and "(Low)" as three separate models.

By default they are folded into one entry with a **Thinking Effort** control beside the
model in the picker, the way Copilot's own models work. Only the tiers the backend
actually routes are offered — Gemini 3.1 Pro shows High and Low but no Medium, because
no such model id exists.

`antigravity.reasoningEffort` sets the starting value; whatever is chosen in the picker
wins for that request. Set `antigravity.effortSelection` to `tiers` to go back to one
picker row per tier.

## Requirements

- VS Code 1.108.0 or later
- A Google account with Antigravity access (the free tier is enough)

Runs in the local UI extension host so it can reach the loopback OAuth port. With Remote-SSH,
keep the extension installed locally rather than installing a second copy on the remote host.

## Common commands

- `Antigravity: Manage` — accounts, quota, logs and settings in one place
- `Antigravity: Sign in with Google`
- `Antigravity: Show Auth Status`
- `Antigravity: Refresh Models and Quota`
- `Antigravity: Open Logs`

## Diagnostics and privacy

Structured logging follows VS Code's log level, adjustable through **Developer: Set Log Level…**.
Every request, auth flow and discovery call carries an `operationId` so retries and endpoint
fallbacks can be traced.

Logs exclude prompts, reasoning, tool arguments and results, credentials and tokens — keeping
only counts, sizes, transport decisions and redacted error text.

## Configuration

Under **Settings → Extensions → Antigravity**:

- `antigravity.modelSelection` — `latest` (default) or `all`
- `antigravity.effortSelection` — `setting` (default) or `tiers`, see above
- `antigravity.hiddenModels` — model ids to omit from the picker
- `antigravity.reasoningEffort` — starting value for the picker's **Thinking Effort** control
- `antigravity.showThinking` — return the model's reasoning and render it as a blockquote
- `antigravity.projectId` — override project discovery, if you see 403s naming a project
- `antigravity.endpoint` — pin generation traffic to one gateway host
- `antigravity.showStatusBar` — show remaining quota

Proxies come from `http.proxy` or `HTTPS_PROXY`/`HTTP_PROXY`, with `NO_PROXY` respected.

### A note on reasoning

VS Code exposes no *thinking part* to third-party model providers, so this extension cannot
produce the collapsible **Thinking…** block that Copilot's own models show. With
`antigravity.showThinking` enabled, reasoning is rendered as a markdown blockquote above the
answer instead.

## Develop locally

```bash
npm install
cp src/api/credentials.example.ts src/api/credentials.ts   # then fill in the values
npm run check          # typecheck + tests + bundle
npm run package:vsix
```

Press <kbd>F5</kbd> for an Extension Development Host.

The OAuth client credentials are deliberately **not** in this repository — see
[`src/api/credentials.example.ts`](src/api/credentials.example.ts) for what to put there and
where it comes from. The build refuses to run without it rather than producing an extension
that cannot authenticate.

### How it works

The gateway speaks a Gemini dialect for **every** model family, Claude included; Anthropic-style
`messages` arrays are rejected outright. Most of the work lives in `src/translate/`:

- **`schema.ts`** — the backend validates tool schemas with protobuf JSON, which hard-fails on any
  unrecognised key. Since VS Code and MCP servers emit their own annotations
  (`enumDescriptions`, `markdownDescription`, …), schemas pass through an **allowlist** of the
  fields the `Schema` proto defines rather than a denylist of known-bad ones.
- **`toGemini.ts`** — a `functionResponse` is paired to its call **by name, not by id**, so the
  message walk records `callId → toolName` on the way past the call.
- **`thinking.ts`** — Gemini selects effort from the tier baked into the model id; only Claude
  takes a numeric budget, capped strictly below `maxOutputTokens`.
- **`api/agent-metadata.ts`** — requests carry the agent envelope: `requestType`, a five-segment
  `requestId`, telemetry labels and an FNV-1a session id, in the field order the real client uses.

## License

MIT. Antigravity, Gemini and Google Cloud are trademarks of Google LLC.
