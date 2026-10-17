# Antigravity Model Bridge

A lightweight VS Code Language Model Provider for the Google Antigravity backend.

[![Install](https://img.shields.io/badge/VS_Code-Install-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=lutfi.antigravity-for-copilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Use **Gemini 3.8 Flash**, **Claude Sonnet 4.6/5.5 (Thinking)**,
**Claude Opus 4.6/5.5 (Thinking)**, and **GPT-OSS 120B (Medium)** when available
to your Antigravity account, from the standard model picker in Chat and Agent mode.
Claude version availability varies; these descriptions do not add or rename model IDs.
Requests run on your Antigravity account rather than Copilot premium requests.

> **Unofficial.** Not affiliated with, endorsed by, or supported by Google. This talks to
> undocumented `v1internal` endpoints, so it can break when Antigravity updates. Use a
> Google account you are willing to risk.

## Highlights

- **Native integration** — the models appear in the standard model picker, in Chat and Agent mode.
- **Automatic model discovery** with a curated default based on the account's gateway catalogue; new discovered chat models appear after refresh, without fabricated unavailable entries.
- **Full tool calling** — built-in, extension and MCP tools are forwarded to the backend, with schemas rewritten to survive its strict validator, including recursive stripping of MCP `x-*` vendor metadata and unique ids across multi-step Agent turns.
- **Antigravity Web Search** — optionally attach `#antigravityWebSearch` in Agent mode to run the installed `agy` CLI's native `search_web` tool and return grounded source URLs.
- **Antigravity Image Generation** — attach `#antigravityGenerateImage` in Agent mode to run the installed `agy` CLI's native `generate_image` tool and return the raster image inline, with optional aspect-ratio control.
- **Native reasoning display** — the model's thinking appears in Copilot Chat's own collapsible block.
- **Context usage reporting** — completed gateway token usage feeds VS Code's Context Window
  widget, including its prompt breakdown when the installed VS Code build supports it.
- **Multi-turn reasoning continuity** — thought signatures are replayed so tool-using conversations survive past the first turn.
- **Quota groups** in the status bar: three distinct allocations for standard Gemini (Flash and Pro), Gemini 4 Argon, and Claude/GPT models, matching native Antigravity usage pools. The percentage is the lowest reported remaining fraction within each group.
- **Account plan and clearer quota details**: the compact bar shows the reported plan alongside Gemini, Argon, and Claude/GPT percentages. Hover for the account, separate quota/reset sections (local time), the number of models actually offered in the picker, and the quota update time. Plan metadata comes from the extension's authenticated account (`loadCodeAssist`, paid tier first), loads in the background, and is cached for five minutes. Missing metadata shows **Not reported**, never an inferred Free/Pro plan; unsuccessful lookups are cached for 30 seconds. Refreshing or changing accounts clears the plan cache.
- **AI credit balance**: when account metadata reports Google One AI credits, the bar also shows `Credits …` and the tooltip includes a separate balance section. Credits share the plan metadata's five-minute cache; use **Antigravity: Refresh Models and Quota** to request fresh data. Missing/invalid balances show **Not reported**, while an explicit zero remains `0`. This is an account credit balance, separate from Gemini, Argon, and Claude/GPT baseline percentages, and displaying it does not enable spending. See [Google's AI credits guide](https://antigravity.google/docs/cli/credits).
- **Thinking Effort control** in the picker, next to the model, offering only the tiers the backend can serve.
- **Multiple accounts**, switched manually.

Tool execution, confirmation, workspace trust and permissions remain handled by VS Code.
The Antigravity Web Search and Image Generation tools are the exceptions in
transport: their registered runners start the local `agy` CLI, while Copilot
still owns tool approval and the conversation loop.

The extension does not silently expose Gaussian/Codex's `codexForCopilot_searchWeb`
marker to Antigravity models. That marker belongs to the Codex Responses backend.
Use `#antigravityWebSearch` when you want the Antigravity-native search bridge.

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

The locally verified account catalogue on **14 October 2026** contains:

- **Gemini 3.8 Flash** — High, Medium, and Low variants, combined into one picker entry by default.
- **Claude Sonnet 4.6 (Thinking)**.
- **Claude Opus 4.6 (Thinking)**.
- **GPT-OSS 120B (Medium)**.

This is a dated account snapshot, not a fixed availability guarantee. Claude is described
as **4.6/5.5** because availability can change; the actual picker always uses discovered
names and IDs. The extension does not synthesize Claude 5.5 model IDs.

**Gemini 4 Argon:** Google officially provides Gemini 4 Argon for Google AI Pro (paid subscriptions) and Google AI Ultra accounts. The bridge adds no placeholder or guessed ID. When a successful discovery returns an Argon chat model, it appears after **Antigravity: Refresh Models and Quota**, folded under its High, Medium, and Low effort tiers with a dedicated quota indicator. Generation depends on account allocation on Google's backend.

The default `latest` filters non-chat/internal aliases, duplicate display names, Flash
Lite, and older Gemini generations. If discovery returns several generations, the
bridge keeps only the newest per product line, including all of its effort tiers.
For example, discovering Gemini 3.8 Flash hides Gemini 3 Flash and 3.5 Flash in this
mode. New Gemini product lines can pass through discovery without a predefined entry.

Set `antigravity.modelSelection` to `all` to include additional discovered generations
and Flash Lite; non-chat/internal aliases and duplicate display names remain filtered.
Use `antigravity.hiddenModels` to hide specific IDs. When discovery fails or returns
an empty catalogue, a conservative fallback uses the verified roster above, never Argon
or guessed Claude versions. A successful catalogue is not supplemented with fallback entries.

### Effort tiers

Antigravity addresses each effort tier as its own model id, so discovery reports
"Gemini 3.8 Flash (High)", "(Medium)" and "(Low)" as three separate models.

By default they are folded into one entry with a **Thinking Effort** control beside the
model in the picker, the way Copilot's own models work. Only tiers reported by
discovery are offered. If a model has only High and Low variants, its
control does not offer Medium.

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

Generation also writes an Info-level `chat timing` summary on completion, cancellation,
or failure. Times are milliseconds from provider entry, measured with a monotonic clock:
translation, project/token resolution, HTTP start/headers, first parsed SSE event,
first thought received, first answer/tool emitted, and total duration. Missing milestones
were not reached. Thought timing can be present even when reasoning is hidden; reasoning
cards and their closing markers do not count as answer text. These timings stop at the
provider and do not include time before provider entry or Copilot's rendering delay.

For retries, the summary keeps the first occurrence of each phase. Set the Antigravity
log channel to **Debug** for `chat phase` records with an attempt number, HTTP status,
and UTF-8 payload size. Subtract `httpStart` from `headers` for the same attempt, or
`projectStart` from `projectEnd`, to isolate those waits. `chat complete` includes cached
token counts when supplied by the gateway.

`chat request` also records `toolGuidance=efficient-v1` when the tool-planning guidance
is applied, or `off` otherwise. `chat complete` reports `toolCalls`, the number of calls
emitted in that response. These counts help compare agent behavior across runs.

Logs exclude prompts, reasoning, tool arguments and results, credentials and tokens — keeping
only counts, sizes, transport decisions and redacted error text.

### Context window

After a completed response, the extension passes the gateway's prompt, completion, cached,
and reasoning token counts to VS Code through its internal `usage` response part. This changes
the context indicator from `0` to the actual reported usage. VS Code 1.120 and newer can then
render the same prompt breakdown used by native providers (system instructions, tool
definitions, messages, and tool results); older builds may continue to show only the response
stream.

## Configuration

Under **Settings → Extensions → Antigravity**:

- `antigravity.modelSelection` — `latest` (default) or `all`
- `antigravity.effortSelection` — `setting` (default) or `tiers`, see above
- `antigravity.hiddenModels` — model ids to omit from the picker
- `antigravity.reasoningEffort` — starting value for the picker's **Thinking Effort** control
- `antigravity.showThinking` — show the model's reasoning (on by default)
- `antigravity.efficientToolUse` — advisory guidance for focused Gemini research and independent read-only tool calls (on by default)
- `antigravity.toolCallIds` — forward tool-call ids on the wire: `claude` (default), `all`, or `off`
- `antigravity.projectId` — override project discovery, if you see 403s naming a project
- `antigravity.endpoint` — pin generation traffic to one gateway host
- `antigravity.showStatusBar` — show the reported account plan, remaining quota, and AI credit balance; hover for details
- `antigravity.cliPath` — optional path to the `agy` executable used by Antigravity Web Search and Image Generation

Proxies come from `http.proxy` or `HTTPS_PROXY`/`HTTP_PROXY`, with `NO_PROXY` respected.

### Tool planning

`antigravity.efficientToolUse` is on by default for Gemini chat requests with available
function tools. It adds a short, stable system instruction that encourages focused
research, reuse of prior evidence, and grouping independent read-only calls in one
response when the host supports it. General web questions should stay focused on web
sources; local files remain appropriate for requests about supplied files, repository
work, local behavior, or required project instructions.

This is advisory model guidance. User/host instructions, necessary checks, approvals,
and the requested tool mode still apply. The bridge retains the tool list, conversation
history, selected effort, and output limits. Claude, GPT-OSS, image models, and requests
without compatible function tools do not receive this guidance.

Set `antigravity.efficientToolUse` to `false` to compare with the previous prompt behavior.
The setting is read for each request. For a useful comparison, use fresh chats with the
same model, effort, tools, and task; compare request count, `toolCalls`, `firstAnswerMs`,
and total task time. Unit tests verify payload preservation and multi-call round trips;
fewer calls and faster completion require live testing and are not guaranteed.

### Reasoning

Reasoning is shown by default, rendered as Copilot Chat's own collapsible **Thinking…**
block. The bridge sends the same completion marker used by Copilot's Agent host when
thinking ends, so the answer stays a normal message instead of being attached to an
unfinished reasoning card. `LanguageModelThinkingPart` is present in the VS Code runtime
but absent from `@types/vscode`, so it is feature-detected: builds that lack it fall back
to a markdown blockquote above the answer. Turn it off with `antigravity.showThinking`.
Hiding reasoning does not disable the model's reasoning. For Gemini, the resolved model
tier and any outgoing `thinkingLevel` stay aligned with the selected tier, including
fallback when a requested tier is unavailable.

Reasoning visibility varies by model and response. Gemini Flash can return thought text
on some requests and only reasoning token counts on others. The log distinguishes the two —
`thoughtTokens>0` with `thoughtParts=0` means the gateway withheld the text, which is a
backend behaviour rather than a fault in this extension.

### Web search

Antigravity Web Search is a VS Code tool backed by the locally installed `agy`
CLI. Select it in the Agent tool picker or reference it as `#antigravityWebSearch`.
The bridge starts a bounded headless `agy` run, instructs it to execute exactly
one native `search_web` call, and returns the resulting markdown answer and
source URLs. It does not reuse the Gaussian/Codex hosted search marker.

The CLI must already be authenticated. Set `antigravity.cliPath` if `agy` is
not on PATH; on Windows the standard `%LOCALAPPDATA%\agy\bin\agy.EXE`
installation is detected automatically. Search runs consume the CLI's own
Antigravity quota and remain subject to its permissions and network policy.

### Image generation

Antigravity Image Generation is a VS Code tool backed by the locally installed
`agy` CLI. Select it in the Agent tool picker or reference it as
`#antigravityGenerateImage`. The bridge starts a bounded headless run and requests
one invocation of the built-in `image-generator` subagent on newer CLI releases,
or one direct `generate_image` call on legacy releases. It asks for one image and
one generation attempt, then attaches
the validated PNG, JPEG, GIF, or WebP result to the tool response. An optional
`aspectRatio` hint (`1:1`, `16:9`, `9:16`, `4:3`, or `3:4`) can guide the native
generator; final dimensions remain controlled by Agy's image backend.

The bridge accepts generated artifacts only from the matching Antigravity
conversation's local brain directory and the child session explicitly reported for
`image-generator`. It never reads arbitrary paths returned by the model or scans
unrelated sessions. Newer Agy CLI builds may omit `output_path` from the headless
event; the bridge then discovers recent raster files in those verified session
directories. It does not expose raw base64 payloads or credentials to chat.
Image generation uses the CLI's Antigravity quota, asks for VS Code confirmation
before starting, and may take longer than a normal text response.

Generated images are also saved under `generated-images` in this extension's local
global storage. The tool returns encoded `file:` image references and **Open image**
links alongside the binary image parts. These local copies remain available while
that storage is retained, even if the CLI cleans up its original artifacts. No image
is uploaded to a separate hosting service; clearing extension storage removes the copies.

For an Antigravity model, the provider appends a missing preview to the completed
answer when a tool result in the current turn contains a reference created by this
extension session. It avoids duplicating an existing image embed and does not append
old images to a new user question. Other model providers can use the same Markdown
returned by the tool. If the host does not render the inline preview, use **Open image**
to open the local file. If preview storage cannot be written, the original tool image
output remains available. Live rendering in each Copilot host still needs verification.

The executable is **`agy`**, not `antigravity`. CLI sign-in is separate from the
extension's OAuth session. A message saying the CLI ran but invoked no image action
does not mean it is uninstalled. Permission waits and terminal errors are reported
separately; the bridge does not bypass CLI approvals.

If the tool reports that **image-generator was invoked but no completed readable raster
image is available**, the subagent may still be running, or the native image backend
may have failed or returned no image. A successful text-agent status alone does not
prove image generation succeeded. Inspect the native `agy` session before retrying;
the bridge only reports an image when validated raster bytes are available. Generated
artifacts remain subject to size and session-path checks.

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
