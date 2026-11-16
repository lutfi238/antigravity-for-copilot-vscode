# Graph Report - antigravity-for-copilot-vscode  (2026-11-16)

## Corpus Check
- 73 files · ~68,319 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 864 nodes · 1602 edges · 59 communities (54 shown, 3 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fce4819c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- toGemini.ts
- statusBar.ts
- oauth.ts
- agyImage.ts
- models.ts
- vscode-stub.ts
- compilerOptions
- package.json
- agyCli.ts
- devDependencies
- provider.ts
- icon.build.cjs
- antigravity.effortSelection
- antigravity.modelSelection
- keywords
- enum
- scripts
- antigravity.endpoint
- esbuild.js
- properties
- antigravity.cliPath
- antigravity.hiddenModels
- antigravity.projectId
- antigravity.showStatusBar
- translate.test.ts
- activationEvents
- dependencies
- galleryBanner
- repository
- credentials.example.ts
- Changelog
- client.ts
- GatewayClient
- Antigravity Model Bridge
- schema.ts
- extension.ts
- fromGemini.ts
- .provideLanguageModelChatResponse
- Antigravity capability audit
- errors.ts
- AccountStore
- contributes
- project.ts
- geminiQuota.ts
- antigravity.toolCallIds
- Source
- Gateway API
- Authentication
- accountPlan.ts
- Protocol Translation
- Extension UI
- Tests
- AGENTS.md
- Antigravity Model Bridge
- enum
- Q: please understand using /graphify
- Q: please understand inside this folder using graphify skills

## God Nodes (most connected - your core abstractions)
1. `Changelog` - 49 edges
2. `AccountStore` - 21 edges
3. `activate()` - 21 edges
4. `GatewayClient` - 18 edges
5. `log` - 17 edges
6. `parseAgyImageStream()` - 16 edges
7. `TokenManager` - 16 edges
8. `QuotaStatusBar` - 15 edges
9. `compilerOptions` - 15 edges
10. `Account` - 14 edges

## Surprising Connections (you probably didn't know these)
- `collect()` --calls--> `readSse()`  [EXTRACTED]
  test/stream.test.ts → src/api/stream.ts
- `storage()` --calls--> `ImageArtifactStore`  [EXTRACTED]
  test/imageArtifacts.test.ts → src/imageArtifacts.ts
- `harness()` --calls--> `AntigravityProvider`  [EXTRACTED]
  test/provider.test.ts → src/provider.ts
- `harness()` --calls--> `newEmitState()`  [EXTRACTED]
  test/translate.test.ts → src/translate/fromGemini.ts
- `harness()` --calls--> `ToolNameMap`  [EXTRACTED]
  test/translate.test.ts → src/translate/schema.ts

## Import Cycles
- None detected.

## Communities (59 total, 3 thin omitted)

### Community 0 - "toGemini.ts"
Cohesion: 0.15
Nodes (22): ModelSpec, BUDGETS, ReasoningEffort, textKey(), append(), buildContents(), BuildOptions, BuildResult (+14 more)

### Community 1 - "statusBar.ts"
Cohesion: 0.10
Nodes (14): AccountPlan, GeminiQuota, QuotaWindow, Catalog, escapeMarkdown(), format(), quotaBlock(), QuotaStatusBar (+6 more)

### Community 2 - "oauth.ts"
Cohesion: 0.10
Nodes (26): FALLBACK_PROJECT_ID, OAUTH_AUTHORIZE_URL, OAUTH_REDIRECT_PATH, OAUTH_REDIRECT_PORT, OAUTH_REDIRECT_URI, OAUTH_SCOPES, OAUTH_TOKEN_URL, OAUTH_USERINFO_URL (+18 more)

### Community 3 - "agyImage.ts"
Cohesion: 0.06
Nodes (67): addUnique(), AgyGeneratedImage, AgyImageRequest, AgyImageResult, AgyImageStreamResult, buildAgyImagePrompt(), collectImageArtifacts(), decodeImageData() (+59 more)

### Community 4 - "models.ts"
Cohesion: 0.07
Nodes (40): ENDPOINT_PROD, asEffort(), availableEfforts(), buildConfigurationSchema(), Effort, EFFORT_DESCRIPTION, EFFORT_LABEL, EFFORT_ORDER (+32 more)

### Community 5 - "vscode-stub.ts"
Cohesion: 0.05
Nodes (19): CancellationError, Disposable, EventEmitter, LanguageModelChatMessageRole, Assistant, User, LanguageModelChatToolMode, Auto (+11 more)

### Community 6 - "compilerOptions"
Cohesion: 0.11
Nodes (18): ES2023, src, compilerOptions, exactOptionalPropertyTypes, lib, module, moduleResolution, noFallthroughCasesInSwitch (+10 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (15): bugs, url, description, displayName, engines, vscode, extensionKind, homepage (+7 more)

### Community 8 - "agyCli.ts"
Cohesion: 0.10
Nodes (30): addUnique(), AGY_SEARCH_AGENT_PREFIX, AGY_SEARCH_MIN_VERSION, agySearchAgentDefinition(), AgySearchStreamResult, AgySearchWorkspace, assertAgySearchAgentSupported(), buildAgySearchArgs() (+22 more)

### Community 9 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, esbuild, @types/node, @types/vscode, typescript, vitest, @vscode/vsce, esbuild (+5 more)

### Community 10 - "provider.ts"
Cohesion: 0.16
Nodes (16): AgentMetadata, AgentSession, buildAgentMetadata(), buildEnvelope(), countSteps(), createSession(), fnv1a64Signed(), MODEL_ENUM (+8 more)

### Community 11 - "icon.build.cjs"
Cohesion: 0.24
Nodes (7): chunk(), crc32(), encodePng(), fs, img, SIZE, zlib

### Community 12 - "antigravity.effortSelection"
Cohesion: 0.20
Nodes (10): default, enum, markdownDescription, markdownEnumDescriptions, type, antigravity.effortSelection, One entry per model, with a **Thinking Effort** control beside it in the picker. Falls back to `#antigravity.reasoningEffort#` when nothing is selected., One picker entry per effort tier, e.g. Gemini 3.8 Flash (High) / (Medium) / (Low). (+2 more)

### Community 13 - "antigravity.modelSelection"
Cohesion: 0.29
Nodes (7): default, markdownDescription, markdownEnumDescriptions, type, antigravity.modelSelection, Keep additional discovered generations and Flash Lite; still exclude non-chat/internal aliases and duplicate display names., Show only the newest discovered Gemini generation per product line, retaining all its effort tiers, plus discovered Claude and GPT-OSS models. Exclude Flash Lite and internal aliases.

### Community 14 - "keywords"
Cohesion: 0.25
Nodes (9): categories, keywords, ai, antigravity, chat, copilot, gemini, gpt-oss (+1 more)

### Community 15 - "enum"
Cohesion: 0.22
Nodes (9): default, enum, markdownDescription, type, antigravity.reasoningEffort, high, low, medium (+1 more)

### Community 16 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, check, compile, package:vsix, test, test:watch, typecheck, vscode:prepublish (+1 more)

### Community 17 - "antigravity.endpoint"
Cohesion: 0.25
Nodes (8): default, description, enum, type, antigravity.endpoint, auto, daily, prod

### Community 18 - "esbuild.js"
Cohesion: 0.33
Nodes (6): esbuild, fs, main(), problemMatcherPlugin, production, watch

### Community 19 - "properties"
Cohesion: 0.18
Nodes (11): default, markdownDescription, type, default, markdownDescription, type, properties, title (+3 more)

### Community 20 - "antigravity.cliPath"
Cohesion: 0.33
Nodes (6): default, markdownDescription, tags, type, antigravity.cliPath, advanced

### Community 21 - "antigravity.hiddenModels"
Cohesion: 0.33
Nodes (6): default, description, items, type, type, antigravity.hiddenModels

### Community 22 - "antigravity.projectId"
Cohesion: 0.50
Nodes (4): default, markdownDescription, type, antigravity.projectId

### Community 23 - "antigravity.showStatusBar"
Cohesion: 0.50
Nodes (4): default, description, type, antigravity.showStatusBar

### Community 24 - "translate.test.ts"
Cohesion: 0.18
Nodes (16): EmitContext, newEmitState(), ToolNameMap, applyThinking(), SignatureCache, buildRequest(), pickGenerationConfig(), assistantMessage() (+8 more)

### Community 25 - "activationEvents"
Cohesion: 0.67
Nodes (3): activationEvents, onLanguageModelChatProvider:antigravity, onStartupFinished

### Community 26 - "dependencies"
Cohesion: 0.67
Nodes (3): dependencies, undici, undici

### Community 27 - "galleryBanner"
Cohesion: 0.67
Nodes (3): galleryBanner, color, theme

### Community 28 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 31 - "Changelog"
Cohesion: 0.04
Nodes (49): 0.0.1, 0.0.2, 0.10.0, 0.11.0, 0.12.0, 0.12.1, 0.12.2, 0.12.3 (+41 more)

### Community 32 - "client.ts"
Cohesion: 0.20
Nodes (15): contentsOf(), EndpointSet, hasId(), isRecord(), partsOf(), RequestOptions, summarizeRequest(), SummaryContent (+7 more)

### Community 33 - "GatewayClient"
Cohesion: 0.17
Nodes (5): AccountPlanService, GatewayClient, GeminiQuotaService, newOperationId(), AntigravityProvider

### Community 34 - "Antigravity Model Bridge"
Cohesion: 0.05
Nodes (35): 1. Current Antigravity Models page: explicit Gemini grouping, 2. Installed official CLI: the same two groups, 3. Plans page: baseline quota is separate from paid overage credits, 4. Google One Help: credits have model-dependent cost, not a baseline percentage, Antigravity Gemini quota-pool research, Artifact evidence and boundaries, Contributor observation and local verification boundary, Decision (+27 more)

### Community 35 - "schema.ts"
Cohesion: 0.20
Nodes (15): appendHint(), clean(), disambiguate(), emptySchema(), fillEmptyObjects(), isObj(), NAME_KEYED_CONTAINERS, Obj (+7 more)

### Community 36 - "extension.ts"
Cohesion: 0.30
Nodes (12): onModelAffectingChange(), activate(), initLogging(), showLogs(), manage(), ManageDeps, removeAccount(), showAuthStatus() (+4 more)

### Community 37 - "fromGemini.ts"
Cohesion: 0.26
Nodes (11): candidatesOf(), closeThinkingPart(), createThinkingPart(), createUsageDataPart(), emitChunk(), emitPart(), EmitState, nonNegative() (+3 more)

### Community 39 - "Antigravity capability audit"
Cohesion: 0.07
Nodes (28): 1. Implemented in 0.14.0: explicit VS Code web-search bridge, 2. Implemented in 0.15.0 (artifact recovery fixed in 0.15.1): explicit VS Code image-generation bridge, 3. Optional shared adapter: standalone MCP server, 4. Exact native harness (high fidelity, high coupling), Agent orchestration (7), Antigravity capability audit, Argon review — 2026-10-18, Automation, media, memory, and lifecycle (5) (+20 more)

### Community 40 - "errors.ts"
Cohesion: 0.23
Nodes (6): describe(), extractMessage(), GatewayError, toGatewayError(), toLanguageModelError(), redact()

### Community 42 - "contributes"
Cohesion: 0.50
Nodes (4): contributes, commands, languageModelChatProviders, languageModelTools

### Community 43 - "project.ts"
Cohesion: 0.39
Nodes (4): bootstrapMetadata(), LoadCodeAssistResponse, OnboardUserResponse, ProjectResolver

### Community 45 - "geminiQuota.ts"
Cohesion: 0.21
Nodes (9): awaitWithSignal(), DISCOVERY_ENDPOINTS, parseGeminiQuota(), record(), findSeparator(), parseEvent(), readSse(), account (+1 more)

### Community 47 - "antigravity.toolCallIds"
Cohesion: 0.25
Nodes (8): default, markdownDescription, markdownEnumDescriptions, type, antigravity.toolCallIds, Forward ids for Claude models only. The gateway's Anthropic adapter requires a non-empty `tool_use.id`, which it cannot always synthesize., Forward ids for every model family, including Gemini., Never forward tool-call ids. Gemini pairs calls to results by name and does not need them.

### Community 48 - "Source"
Cohesion: 0.29
Nodes (7): Child DOX Index, Local Contracts, Ownership, Purpose, Source, Verification, Work Guidance

### Community 49 - "Gateway API"
Cohesion: 0.29
Nodes (7): Child DOX Index, Gateway API, Local Contracts, Ownership, Purpose, Verification, Work Guidance

### Community 50 - "Authentication"
Cohesion: 0.29
Nodes (7): Authentication, Child DOX Index, Local Contracts, Ownership, Purpose, Verification, Work Guidance

### Community 51 - "accountPlan.ts"
Cohesion: 0.52
Nodes (5): creditBalance(), parseAccountPlan(), record(), text(), account

### Community 52 - "Protocol Translation"
Cohesion: 0.29
Nodes (7): Child DOX Index, Local Contracts, Ownership, Protocol Translation, Purpose, Verification, Work Guidance

### Community 53 - "Extension UI"
Cohesion: 0.29
Nodes (7): Child DOX Index, Extension UI, Local Contracts, Ownership, Purpose, Verification, Work Guidance

### Community 54 - "Tests"
Cohesion: 0.29
Nodes (7): Child DOX Index, Local Contracts, Ownership, Purpose, Tests, Verification, Work Guidance

### Community 55 - "AGENTS.md"
Cohesion: 0.33
Nodes (3): GitHub automation, Ownership and contracts, Verification

### Community 56 - "Antigravity Model Bridge"
Cohesion: 0.33
Nodes (6): Antigravity Model Bridge, Child DOX Index, Purpose, Repository Contracts, Verification, Work Guidance

### Community 58 - "enum"
Cohesion: 0.33
Nodes (6): enum, enum, all, claude, latest, off

### Community 60 - "Q: please understand using /graphify"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: please understand using /graphify, Source Nodes

### Community 61 - "Q: please understand inside this folder using graphify skills"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: please understand inside this folder using graphify skills, Source Nodes

## Knowledge Gaps
- **335 isolated node(s):** `esbuild`, `fs`, `production`, `problemMatcherPlugin`, `fs` (+330 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 395 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `properties` connect `properties` to `antigravity.effortSelection`, `antigravity.modelSelection`, `enum`, `antigravity.toolCallIds`, `antigravity.endpoint`, `antigravity.cliPath`, `antigravity.hiddenModels`, `antigravity.projectId`, `antigravity.showStatusBar`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `config` connect `agyCli.ts` to `statusBar.ts`, `provider.ts`, `agyImage.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `log` connect `client.ts` to `statusBar.ts`, `oauth.ts`, `agyImage.ts`, `models.ts`, `extension.ts`, `provider.ts`, `project.ts`, `geminiQuota.ts`, `accountPlan.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `activate()` (e.g. with `.active()` and `.refresh()`) actually correct?**
  _`activate()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `esbuild`, `fs`, `production` to the rest of the system?**
  _335 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `toGemini.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1476923076923077 - nodes in this community are weakly interconnected._
- **Should `statusBar.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10037878787878787 - nodes in this community are weakly interconnected._