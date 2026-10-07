---
type: "query"
date: "2026-10-07T14:18:49.027308+00:00"
question: "please understand inside this folder using graphify skills"
contributor: "graphify"
outcome: "useful"
source_nodes: ["activate()", "AntigravityProvider", "GatewayClient", "AccountStore", "TokenManager", "buildRequest()", "emitChunk()", "runAgyImage()", "runAgySearch()"]
---

# Q: please understand inside this folder using graphify skills

## Answer

Repository orientation verified on 2026-10-07. Expanded from the original query using graph vocabulary: activate, provider, account, token, gateway, request, gemini, stream, thinking, quota, agy, test.

Graph evidence: existing graph has 537 nodes, 1016 edges and 31 communities; report dated 2026-09-05 at cb2247f7. Graphify query and explain identify activate(), AntigravityProvider, GatewayClient, AccountStore and TokenManager as navigation anchors. Current HEAD is b44a531, so graph locations and edges are historical. No rebuild was requested or performed. Queries are deterministic; no separate extraction-model API tokens were used (host-session tokens not measured).

Current-source verification: src/extension.ts:14 constructs AccountStore, TokenManager, GatewayClient, ProjectResolver, QuotaStatusBar and AntigravityProvider, and registers provider vendor antigravity, management commands and two native tools. src/provider.ts:147 coordinates effort selection, model tier resolution, Gemini request translation, project lookup, telemetry envelope, authenticated gateway streaming, response conversion and usage reporting. It has a 60-second catalogue cache; local token counts are character-based estimates. src/api/client.ts:119 implements daily/production endpoint fallback and a single forced-token-refresh retry on 401. src/api/http.ts handles configured/environment proxies and NO_PROXY.

Authentication: OAuth uses PKCE and state validation with a fixed 127.0.0.1:51121 callback listener. AccountStore persists refresh-token-bearing accounts in VS Code SecretStorage and active email in globalState. TokenManager caches access tokens in memory, refreshes five minutes early, single-flights per account and persists rotated refresh tokens. ProjectResolver tries explicit configuration, cached account project, loadCodeAssist, onboardUser, then a fallback.

Translation: every family, including Claude and GPT-OSS, uses Gemini contents. Tool names and schemas are normalized; ordered call/result pairing is retained. Current source forwards tool ids for Claude by default. Thought signatures are held in a bounded in-memory cache. Incoming SSE becomes text, native thinking or fallback text, globally unique tool calls, and private usage data; vscode_reasoning_done closes native thinking and usage metadata is excluded from outgoing history.

Discovery: fetchAvailableModels is parsed as an id-keyed map. Picker curation keeps three recent Gemini generations per line by default, collapses effort tiers, and aggregates Gemini Pro, Gemini Flash and Claude/GPT quota buckets. Current all mode still filters non-chat aliases and duplicate names. Empty discovery results also trigger the built-in roster, despite stricter wording in the API guidance.

Native tools: webSearch.ts/agyCli.ts launch an authenticated local agy process for search_web; imageGeneration.ts/agyImage.ts launch generate_image and validate raster data and trusted brain paths, recovering recent files from validated conversation directories when needed. Image execution rejects unexpected tools and has a local watchdog. Search prompts request one tool and the parser verifies search_web occurred, but does not enforce absence of other tools; do not claim equivalent enforcement on both paths.

Verification: npm.cmd run check passed typecheck, 173 tests in 11 files, and esbuild bundle. Tests use a vscode stub and offline fixtures. No Extension Development Host, live OAuth/gateway or real agy execution was tested. Auth and UI have no direct unit suites. Current package version is 0.15.5, while latest changelog heading is 0.15.4. Existing package, lockfile, changelog and Graphify worktree edits were preserved. No product-source edits or commits were made; check regenerated ignored dist output and Graphify updated local query/reflection artifacts.

## Outcome

- Signal: useful

## Source Nodes

- activate()
- AntigravityProvider
- GatewayClient
- AccountStore
- TokenManager
- buildRequest()
- emitChunk()
- runAgyImage()
- runAgySearch()