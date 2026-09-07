# Graph Report - antigravity-for-copilot-vscode  (2026-09-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 537 nodes · 1016 edges · 31 communities (29 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cb2247f7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29

## God Nodes (most connected - your core abstractions)
1. `AccountStore` - 21 edges
2. `activate()` - 18 edges
3. `TokenManager` - 16 edges
4. `parseAgyImageStream()` - 15 edges
5. `compilerOptions` - 15 edges
6. `collectImageArtifacts()` - 12 edges
7. `GatewayClient` - 12 edges
8. `SignatureCache` - 12 edges
9. `log` - 11 edges
10. `AntigravityProvider` - 11 edges

## Surprising Connections (you probably didn't know these)
- `collect()` --calls--> `readSse()`  [EXTRACTED]
  test/stream.test.ts → src/api/stream.ts
- `harness()` --calls--> `newEmitState()`  [EXTRACTED]
  test/translate.test.ts → src/translate/fromGemini.ts
- `harness()` --calls--> `ToolNameMap`  [EXTRACTED]
  test/translate.test.ts → src/translate/schema.ts
- `build()` --calls--> `SignatureCache`  [EXTRACTED]
  test/translate.test.ts → src/translate/thinking.ts
- `harness()` --calls--> `SignatureCache`  [EXTRACTED]
  test/translate.test.ts → src/translate/thinking.ts

## Import Cycles
- None detected.

## Communities (31 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (60): ModelSpec, fallbackSpec(), candidatesOf(), closeThinkingPart(), createThinkingPart(), createUsageDataPart(), emitChunk(), EmitContext (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (25): GatewayClient, bootstrapMetadata(), ProviderChatInformation, Catalog, QuotaBucket, ProjectResolver, Account, AccountStore (+17 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (41): EndpointSet, RequestOptions, DISCOVERY_ENDPOINTS, FALLBACK_PROJECT_ID, GENERATION_ENDPOINTS, OAUTH_AUTHORIZE_URL, OAUTH_REDIRECT_PATH, OAUTH_REDIRECT_PORT (+33 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (54): addUnique(), AgyGeneratedImage, AgyImageRequest, AgyImageResult, AgyImageStreamResult, buildAgyImagePrompt(), collectImageArtifacts(), decodeImageData() (+46 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (41): ENDPOINT_PROD, asEffort(), availableEfforts(), buildConfigurationSchema(), Effort, EFFORT_DESCRIPTION, EFFORT_LABEL, EFFORT_ORDER (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (18): CancellationError, EventEmitter, LanguageModelChatMessageRole, Assistant, User, LanguageModelChatToolMode, Auto, Required (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (18): ES2023, src, compilerOptions, exactOptionalPropertyTypes, lib, module, moduleResolution, noFallthroughCasesInSwitch (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (15): bugs, url, description, displayName, engines, vscode, extensionKind, homepage (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.20
Nodes (11): AgySearchStreamResult, buildAgySearchPrompt(), isRecord(), parseAgySearchStream(), resolveAgyCommand(), runAgySearch(), workspaceCwd(), ENDPOINT_DAILY (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (13): devDependencies, esbuild, @types/node, @types/vscode, typescript, vitest, @vscode/vsce, esbuild (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.24
Nodes (11): AgentMetadata, AgentSession, buildAgentMetadata(), buildEnvelope(), countSteps(), createSession(), fnv1a64Signed(), MODEL_ENUM (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (7): chunk(), crc32(), encodePng(), fs, img, SIZE, zlib

### Community 12 - "Community 12"
Cohesion: 0.20
Nodes (10): default, enum, markdownDescription, markdownEnumDescriptions, type, antigravity.effortSelection, One entry per model, with a **Thinking Effort** control beside it in the picker. Falls back to `#antigravity.reasoningEffort#` when nothing is selected., One picker entry per effort tier, e.g. Gemini 3.8 Flash (High) / (Medium) / (Low). (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.20
Nodes (10): default, enum, markdownDescription, markdownEnumDescriptions, type, antigravity.modelSelection, all, Antigravity own published list: the three newest Gemini generations of each line, plus Claude and GPT-OSS. Older Gemini, Flash Lite and internal Tab/Chat/image/tiered models are removed. (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.22
Nodes (10): categories, keywords, ai, antigravity, chat, claude, copilot, gemini (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.22
Nodes (9): default, enum, markdownDescription, type, antigravity.reasoningEffort, high, low, medium (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (9): scripts, check, compile, package:vsix, test, test:watch, typecheck, vscode:prepublish (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.25
Nodes (8): default, description, enum, type, antigravity.endpoint, auto, daily, prod

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (6): esbuild, fs, main(), problemMatcherPlugin, production, watch

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (7): properties, title, contributes, commands, configuration, languageModelChatProviders, languageModelTools

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (6): default, markdownDescription, tags, type, antigravity.cliPath, advanced

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (6): default, description, items, type, type, antigravity.hiddenModels

### Community 22 - "Community 22"
Cohesion: 0.50
Nodes (4): default, markdownDescription, type, antigravity.projectId

### Community 23 - "Community 23"
Cohesion: 0.50
Nodes (4): default, description, type, antigravity.showStatusBar

### Community 24 - "Community 24"
Cohesion: 0.50
Nodes (4): default, markdownDescription, type, antigravity.showThinking

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (3): activationEvents, onLanguageModelChatProvider:antigravity, onStartupFinished

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (3): dependencies, undici, undici

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (3): galleryBanner, color, theme

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **166 isolated node(s):** `esbuild`, `fs`, `production`, `problemMatcherPlugin`, `fs` (+161 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 203 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `properties` connect `Community 19` to `Community 12`, `Community 13`, `Community 15`, `Community 17`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 24`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `config` connect `Community 8` to `Community 1`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `contributes` connect `Community 19` to `Community 7`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `activate()` (e.g. with `.active()` and `.refresh()`) actually correct?**
  _`activate()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `esbuild`, `fs`, `production` to the rest of the system?**
  _166 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06219918548685672 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.074034902168165 - nodes in this community are weakly interconnected._