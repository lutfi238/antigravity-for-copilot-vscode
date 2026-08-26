# Antigravity for Copilot

A VS Code **Language Model Provider** that puts Google Antigravity's models into the native
Copilot Chat model picker. Sign in with Google once, and Gemini 3 Pro, Gemini 3 Flash,
Claude Sonnet 4.6, Claude Opus 4.6 and GPT-OSS 120B become selectable models — running on your
Antigravity quota rather than Copilot premium requests.

It ships no chat UI of its own. Agent mode, tool calling, confirmations, workspace trust and MCP
all stay VS Code's; this extension only handles auth, model discovery, transport and protocol
translation.

---

## ⚠️ Read this first

This extension talks to Google's **undocumented `v1internal` Antigravity gateway**. The project this
was built from ([`NoeFabris/opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth))
states plainly that this access path **violates Google's Terms of Service**, and reports users whose
accounts were **banned or shadow-banned**.

By using this you accept that:

- It is an unofficial tool, not endorsed by or affiliated with Google.
- The Google account you sign in with may be suspended or permanently banned.
- The endpoints are version-pinned and undocumented; they will break without notice.

Personal and internal development use only. Not for production, and not for circumventing limits.

---

## Setup

```bash
npm install
npm run check      # typecheck + tests + bundle
```

Press <kbd>F5</kbd> for an Extension Development Host, then:

1. **Antigravity: Sign in with Google** from the Command Palette — a browser opens, and the callback
   lands on `http://localhost:51121/oauth-callback`.
2. Open Copilot Chat and pick an Antigravity model from the model picker.

Port 51121 is **not configurable**: it is the redirect URI registered with the OAuth client, and
Google rejects any other. If it is in use (Antigravity itself, or another sign-in in flight), free it.

## Commands

| Command | Purpose |
|---|---|
| `Antigravity: Manage` | Accounts, quota, logs, settings — also the model picker's *Manage* target |
| `Antigravity: Sign in with Google` | Add an account |
| `Antigravity: Show Auth Status` | List stored accounts and which is active |
| `Antigravity: Refresh Models and Quota` | Force rediscovery |
| `Antigravity: Open Logs` | Show the output channel |

## Settings

| Setting | Default | Notes |
|---|---|---|
| `antigravity.reasoningEffort` | `medium` | Thinking budget; always capped below the model's output limit |
| `antigravity.showThinking` | `false` | Surface reasoning as chat text (VS Code has no thinking part in this API version) |
| `antigravity.projectId` | `""` | Override project discovery — set this if you hit 403s mentioning a project |
| `antigravity.hiddenModels` | `[]` | Model ids to omit from the picker |
| `antigravity.endpoint` | `auto` | Pin to one gateway host instead of walking the fallback chain |
| `antigravity.showStatusBar` | `true` | Quota indicator |

Proxies come from `http.proxy` or `HTTPS_PROXY`/`HTTP_PROXY`, with `NO_PROXY` respected.

## How it works

```
VS Code chat protocol            Antigravity gateway
─────────────────────            ───────────────────
LanguageModelChatRequestMessage  →  contents[] (role: user | model)
LanguageModelChatTool            →  functionDeclarations (sanitized schema + name)
LanguageModelToolResultPart      →  functionResponse (matched by name, not id)
candidates[].parts               →  LanguageModelTextPart / LanguageModelToolCallPart
```

The gateway speaks a **Gemini dialect for every model family** — Claude included. Anthropic-style
`messages` arrays are rejected outright. Most of the work lives in `src/translate/`:

- **`schema.ts`** — the gateway's protobuf validator rejects `$ref`, `$defs`, `const`, `default`,
  `additionalProperties` and friends, and enforces `^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$` on tool names.
  Real MCP servers violate both constantly, so schemas are rewritten (`const` → single-value `enum`,
  types uppercased to proto enum names) and names are sanitized through a bidirectional map.
- **`toGemini.ts`** — Gemini pairs a `functionResponse` to its call **by name, not by id**, so the
  message walk records `callId → toolName` on the way past the call.
- **`thinking.ts`** — Gemini 3 returns a `thoughtSignature` that must be echoed back on later turns.
  VS Code's message history has no field to carry it, so it is cached against the tool-call id.
  Without this, multi-turn tool-using conversations fail on turn two.
- Also enforced: `maxOutputTokens` **strictly greater than** `thinkingBudget`, and `systemInstruction`
  as an object with `parts` (a bare string is a 400).

## Deliberately not implemented

The reference project rotates User-Agent and `X-Goog-Api-Client` values per request, and rotates
across multiple accounts with a soft-quota threshold to avoid exhausting any one of them. Both exist
to defeat fingerprinting and stretch quota, not to make the client work. This extension sends one
stable client identity, and multi-account support is **manual switching only**.

Google Search grounding is also out: `googleSearch` and `urlContext` cannot coexist with
`functionDeclarations`, and agent mode always sends tools.

## Tests

```bash
npm test
```

44 tests cover the pure translation layer — schema sanitization, tool-name round trips, SSE frame
reassembly across chunk boundaries, role mapping, tool-call pairing and thinking budgets. That is
where regressions actually live; the network layers are verified by hand against the live gateway.

## License

MIT. Not affiliated with Google. Antigravity, Gemini and Google Cloud are trademarks of Google LLC.
