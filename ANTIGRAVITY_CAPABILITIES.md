# Antigravity capability audit

Snapshot taken **2026-09-04 (Asia/Jakarta)**. This is a read-only comparison of
the installed Antigravity CLI (`agy`) with the public Antigravity SDK and the
current VS Code provider boundary. It is intended to answer whether this
extension can reproduce the native Antigravity/Gaussian-style search and tool
experience. No access tokens, cookies, account identifiers, request bodies, or
credential values are included.

## Executive conclusion

Antigravity is an agent harness, not only a model catalogue. The current CLI
advertises a **57-name runtime tool surface** in its headless `stream-json`
initialisation event. The public SDK documents **13 stable built-in tool names**,
including filesystem operations, shell execution, image generation, web search,
URL reading, questions, subagents, and `finish`.

The extension in this repository bridges the model/gateway layer and now adds
two explicit host-side bridges for native web search and image generation. It
still forwards ordinary tools supplied by the VS Code caller and converts
returned tool calls; it does not automatically acquire the rest of the native
`agy` harness. A model ID such as Gemini 3.8 Flash therefore does not, by
itself, make `/codesearch`, browser automation, or native subagents available
inside Copilot Chat.

The closest safe analogue to the Gaussian/Codex pattern is an explicit tool
bridge: register a small set of VS Code language-model tools (or a standalone
MCP server) and pass those declarations into requests. The bridge must own
execution, permissions, cancellation, result limits, and attribution. Merely
adding native tool names to the Gemini request would produce calls that nobody
executes.

## Evidence snapshot

Commands were run from the repository root. Output below is intentionally
summarised where it could contain machine-specific paths.

| Command | Observed result | What it proves |
| --- | --- | --- |
| `Get-Command agy -All` | `C:\Users\<user>\AppData\Local\agy\bin\agy.EXE` | The live reference is the locally installed CLI, not a guessed package. |
| `agy --version` | `1.1.26` | CLI version used for this snapshot. |
| `Get-FileHash ...agy.EXE -Algorithm SHA256` | `17A09D8C8B5A0BC3CC36904DEED78126A56D5C47CCF28186743ACB848F5F780D` | Reproducibility fingerprint for the binary at audit time. |
| `agy --help` | Flags for `--model`, `--effort`, `--agent`, `--sandbox`, `--output-format`, `--input-format`, `--json-schema`, and subcommands `agent`, `models`, `mcp`, `plugin`, `remote-control`, etc. | The CLI has a scripted/headless surface in addition to its TUI. |
| `agy models` | 14 account-visible entries: Gemini 3.8/3.7/3.6 Flash (high/medium/low), Gemini 3.1 Pro (high/low), Claude Sonnet 4.6, Claude Opus 4.6 Thinking, GPT-OSS 120B Medium. | Model availability is account/backend state and should be read live. |
| `agy --print '/help' --output-format text` | Directly handled commands included `/agents`, `/config`, `/credits`, `/effort`, `/help`, `/hooks`, `/model`, `/permissions`, `/skills`, `/usage`. | Print mode exposes a subset of slash commands; panel-only commands are not a complete tool inventory. |
| `agy --print 'Reply exactly OK; do not use tools.' --output-format stream-json --disable-slash-commands` | `init.permission_mode=request-review`; `init.tools` contained the exact 57 names listed below. | This is the authoritative live runtime surface observed for this CLI session. |
| `agy --print 'Use the search_web tool once ...' --output-format stream-json --dangerously-skip-permissions` | A `step_update` with `tool_name: "search_web"`, then a successful result. | Native web search is an executable built-in tool, not merely documentation. |
| `agy --print 'Use the read_url_content tool once ...' --output-format stream-json --dangerously-skip-permissions` | A `step_update` with `tool_name: "read_url_content"`, then a successful result. | Native URL reading is a separate executable tool. |
| `agy mcp list` | One enabled stdio server (`roblox-executor-mcp`; command path redacted). | MCP is configured separately from the generic built-in tools. |
| `agy plugin list` | `No imported plugins.` | No imported plugin contributed extra tools in this snapshot. |
| `agy remote-control status` | `Daemon status: not registered`. | Remote control was not active during the audit. |

The stream protocol itself is documented by Google: `init.tools` is the list of
available tool names; tool steps carry `tool_name` and `tool_info` with call
parameters/results; subagent steps carry `subagent_info`.

## Public SDK built-ins (13)

The official SDK reference lists these names and explicitly says that
`SEARCH_WEB` and `READ_URL_CONTENT` are enabled by default:
[`sdk/tools.md`](https://antigravity.google/docs/sdk/tools.md) (table and web
tool sections, lines 7–25 and 64–78). The enum source is also public at
[`types.py`](https://github.com/google-antigravity/antigravity-sdk-python/blob/main/google/antigravity/types.py#L293-L360).

| Public SDK name | Purpose | Live CLI spelling/relationship |
| --- | --- | --- |
| `list_directory` | List directory contents | `list_dir` in the current CLI runtime |
| `search_directory` | Search within files/directories | `grep_search` in the current CLI runtime |
| `find_file` | Find files by name/pattern | `find_by_name` in the current CLI runtime |
| `view_file` | Read file contents | Same spelling |
| `create_file` | Create a file | `write_to_file` in the current CLI runtime |
| `edit_file` | Edit a file | `replace_file_content`, `multi_replace_file_content`, `sed_file`; notebook-specific edit tools also exist |
| `run_command` | Execute a shell command | Same spelling; `command_status` and `send_command_input` support long-running commands |
| `ask_question` | Ask the user for input | Same spelling |
| `start_subagent` | Start a child agent | `invoke_subagent`/`define_subagent` plus management tools in the current CLI |
| `generate_image` | Generate or edit an image | Same spelling |
| `search_web` | Perform Google Search | Same spelling; verified by a live tool step |
| `read_url_content` | Fetch URL content | Same spelling; verified by a live tool step |
| `finish` | Return final output | Same spelling |

The SDK also provides `enabled_tools`/`disabled_tools` filtering and helper
sets such as `read_only()`. This is a capability-selection API, not a promise
that every client surface exposes every tool.

## Live CLI runtime surface (57 names)

The following exact list came from the `init.tools` array, parsed from:

```powershell
$raw = agy --print "Reply exactly OK; do not use tools." `
  --output-format stream-json --disable-slash-commands --print-timeout 45s
($raw | Where-Object { $_ -match '"event":"init"' } | ConvertFrom-Json).init.tools
```

The names are grouped by function for readability; grouping is ours, while the
spelling and membership are copied from the runtime event.

### Human approval and security (4)

`ask_custom_permission`, `ask_permission`, `ask_question`, `list_permissions`

### Filesystem and notebooks (10)

`find_by_name`, `grep_search`, `list_dir`, `multi_replace_file_content`,
`notebook_edit`, `notebook_execution`, `replace_file_content`, `sed_file`,
`view_file`, `write_to_file`

### Terminal (3)

`command_status`, `run_command`, `send_command_input`

### Browser automation (23)

`browser_click_element`, `browser_drag_pixel_to_pixel`, `browser_get_dom`,
`browser_get_network_request`, `browser_input`, `browser_list_network_requests`,
`browser_mouse_down`, `browser_mouse_up`, `browser_move_mouse`,
`browser_press_key`, `browser_refresh_page`, `browser_resize_window`,
`browser_scroll`, `browser_scroll_dom`, `browser_select_option`,
`browser_subagent`, `capture_browser_console_logs`, `capture_browser_screenshot`,
`click_browser_pixel`, `execute_browser_javascript`, `list_browser_pages`,
`open_browser_url`, `read_browser_page`

### Web retrieval (2)

`read_url_content`, `search_web`

### MCP resources and dispatch (3)

`call_mcp_tool`, `list_resources`, `read_resource`

### Agent orchestration (7)

`define_subagent`, `invoke_subagent`, `manage_subagents`, `manage_task`,
`send_message`, `wait`, `wait_5_seconds`

### Automation, media, memory, and lifecycle (5)

`schedule`, `generate_image`, `delete_knowledge`, `manage_inbox`, `finish`

The total is 57 (4 + 10 + 3 + 23 + 2 + 3 + 7 + 5). Names such as
`browser_*`, `manage_*`, and `call_mcp_tool` are harness/runtime names; they are
not all members of the public SDK `BuiltinTools` enum.

### Observed native call shapes

Historical CLI trajectory records also show the argument names used by the
harness. These are useful for a future adapter, but they are observed
implementation details rather than a versioned API (optional fields are marked
with `?`):

| Tool | Observed arguments |
| --- | --- |
| `list_dir` | `DirectoryPath` |
| `find_by_name` | `Pattern`, `SearchDirectory`, `Excludes?`, `MaxDepth?` |
| `view_file` | `AbsolutePath`, `StartLine?`, `EndLine?`, `ContentOffset?` |
| `grep_search` | `Query`, `SearchPath`, `CaseInsensitive?`, `IsRegex?`, `MatchPerLine?` |
| `run_command` | `CommandLine`, `Cwd`, `IsDaemon`, `WaitMsBeforeAsync` |
| `replace_file_content` | `TargetFile`, `TargetContent`, `ReplacementContent`, `StartLine?`, `EndLine?`, `AllowMultiple?`, `Description?`, `Instruction?` |
| `write_to_file` | `TargetFile`, `CodeContent`, `Description`, `Overwrite?`, `ArtifactMetadata?` |
| `search_web` | `query` |
| `read_url_content` | `Url` |
| `call_mcp_tool` | `ServerName`, `ToolName`, `Arguments` |
| `invoke_subagent` | `Subagents` |
| `manage_task` | `Action`, `TaskId` |
| `schedule` | `DurationSeconds`, `Prompt`, `TimerCondition?` |
| `ask_question` | `questions` |
| `send_message` | `Recipient`, `Message` |

The records were mined from local CLI trajectories and intentionally exclude
argument values. They confirm that native workspace search (`grep_search`) and
web search (`search_web`) are separate harness calls; neither is automatically
an MCP function.

## Search is three different capabilities

| Capability | Native Antigravity contract | Important distinction |
| --- | --- | --- |
| Workspace code search | `/codesearch` (aliases `/cs` and `/search`) opens an interactive panel; regex/smart-case, `-F` literal mode, `f:`/`path:` filters, file viewer, and line comments are documented in [`cli/commands/codesearch.md`](https://antigravity.google/docs/cli/commands/codesearch.md). | This is a CLI/TUI workflow. It is not the same thing as the SDK `search_web` tool, and no public VS Code API endpoint for the panel was found. |
| Web search | `search_web` (public SDK built-in and live runtime name). | It searches the web and returns a tool result; it is not a local workspace grep. |
| URL retrieval | `read_url_content` (public SDK built-in and live runtime name). | It fetches/reads a known URL; it is separate from interactive browser actuation. |

Antigravity’s browser surface adds tab navigation, DOM inspection, screenshots,
network-request inspection, JavaScript, mouse/keyboard input, and a browser
subagent. The official browser overview describes a separate/isolated Chrome
profile and URL allowlist/denylist controls:
[`ide/browser`](https://antigravity.google/docs/ide/browser.md).

The browser names above are an advertised surface, not a claim that every one
worked on this machine: the local CLI log recorded a Playwright driver download
failure (HTTP 404) during startup. Web search and URL reading were independently
observed as successful tool steps; browser execution should be re-tested after
the CLI repairs or bundles its driver.

The executable contains strings resembling internal step kinds such as
`code_search`, `internal_search`, and `tool_search`, but those are implementation
symbols rather than a documented/public invocation contract. They should not be
copied into the extension as if they were stable APIs.

## What Gaussian/Codex is actually doing

The installed Gaussian 1.8.1 extension is a useful reference, but its search
path is not an Antigravity MCP server:

1. Its `package.json` contributes a VS Code `languageModelTools` marker named
   `codexForCopilot_searchWeb` with an empty object schema and a description that
   says the Codex backend executes the search. See the upstream source at
   [`package.json#L72-L90`](https://github.com/GaussianGuaicai/Codex-For-Copilot/blob/master/package.json#L72-L90).
2. The provider partitions that marker out of ordinary client/function tools.
   When selected, it creates an OpenAI Responses tool with
   `{ type: "web_search", external_web_access, search_context_size, filters }`.
   See [`hostedToolPlan.ts#L13-L56`](https://github.com/GaussianGuaicai/Codex-For-Copilot/blob/master/src/hostedTools/hostedToolPlan.ts#L13-L56).
3. The marker is registered with `vscode.lm.registerTool` only so VS Code can
   display/reference it; the provider does not execute a client-side search
   function. The hosted Responses backend executes the search and emits web
   search lifecycle/source data. See [`webSearchTool.ts#L4-L12`](https://github.com/GaussianGuaicai/Codex-For-Copilot/blob/master/src/hostedTools/webSearchTool.ts#L4-L12).

Gaussian also has a separate **Native Tool Search** feature. It converts a
large selected VS Code tool catalogue into OpenAI `namespace` entries with
deferred functions and appends `{ type: "tool_search" }`; calls are mapped back
to the original VS Code tools. That is tool-catalogue retrieval, not web
search, and it is also a hosted Responses capability rather than MCP. See
[`nativeToolCatalog.ts#L62-L100`](https://github.com/GaussianGuaicai/Codex-For-Copilot/blob/master/src/nativeToolSearch/nativeToolCatalog.ts#L62-L100)
and the extension's [`README` tool-discovery explanation](https://github.com/GaussianGuaicai/Codex-For-Copilot/blob/master/README.md#tool-discovery).

The practical mapping is therefore:

| User-facing feature | Tool declaration | Who executes it | Protocol class |
| --- | --- | --- | --- |
| Gaussian Web Search | `codexForCopilot_searchWeb` marker → `web_search` | OpenAI Codex Responses backend | Hosted provider tool |
| Gaussian Native Tool Search | deferred namespaces → `tool_search` | OpenAI Codex Responses backend, then VS Code runs the selected function | Hosted tool discovery + VS Code tool loop |
| Antigravity web search | `search_web` | Antigravity native harness/backend | Built-in harness tool |
| Antigravity workspace search | `/codesearch` UI; runtime search tools such as `grep_search`/`code_search` | Antigravity native harness | CLI workflow/harness tool |
| Custom MCP search | server-specific MCP function(s) via `call_mcp_tool` | The configured MCP server | MCP |

This distinction matters for our extension: copying Gaussian's marker name
would not make Antigravity search work. We would need either a host-side
`antigravity_code_search`/`antigravity_web_search` runner, a real MCP client or
server bridge, or a separately maintained `agy` sidecar. An undocumented
`v1internal` tool field should not be guessed from the binary strings alone.

## MCP and customization model

The official MCP guide says that Antigravity supports local stdio and remote
MCP servers, with global `~/.gemini/config/mcp_config.json` and workspace
`.agents/mcp_config.json` locations. It documents `command`/`serverUrl`,
`args`, `env`, `cwd`, `headers`, OAuth/Google credentials, disabled tools, and
permission patterns such as `mcp(server/tool)` and `mcp(server/*)`:
[`mcp.md`](https://antigravity.google/docs/mcp.md), lines 67–95, 102–145, and
253–259.

In the current CLI, the model sees the generic `call_mcp_tool` dispatcher in the
headless init list. A configured server’s individual tools are discovered and
executed by the native harness; they are not evidence that the VS Code provider
can invoke that server directly.

Plugins package skills, agents, rules, MCP definitions, and hooks. Skills and
custom agents affect instructions/discovery; they do not magically add their
tools to an unrelated VS Code language-model request. The CLI feature and
reference pages describe this packaging and the asynchronous subagent model:
[`cli/features.md`](https://antigravity.google/docs/cli/features.md) and
[`cli/reference.md`](https://antigravity.google/docs/cli/reference.md).

## Boundary in this extension

The repository evidence is explicit:

- [`package.json`](package.json) contributes a
  `languageModelChatProviders` entry and the `antigravity_web_search`/
  `antigravity_generate_image` `languageModelTools` markers.
- [`src/extension.ts`](src/extension.ts) registers the Antigravity language-model
  provider, management commands, and the web-search/image-generation runners.
- [`src/provider.ts`](src/provider.ts) passes `options.tools` into the Gemini
  request builder. Incoming function calls are emitted as VS Code
  `LanguageModelToolCallPart` values; the provider does not execute them.
- [`src/agyCli.ts`](src/agyCli.ts) is the explicit exception: it starts the
  configured local `agy` executable for the web-search tool, parses its
  `stream-json` result, and requires an observed `search_web` step before
  returning output.
- [`src/agyImage.ts`](src/agyImage.ts) is the image-generation sidecar bridge. It
  requires an observed `generate_image` step, accepts only validated raster
  artifacts from Antigravity brain directories, and bounds both image count and
  byte size before creating VS Code image data parts.
- The VS Code type contract says that `ProvideLanguageModelChatResponseOptions.tools`
  are supplied by the caller, and that the caller must invoke the tool and send
  a `LanguageModelToolResultPart` back. The same contract says a tool registered
  with `lm.registerTool` is only visible to a model when the caller passes it in
  the request (`node_modules/@types/vscode/index.d.ts`, lines 20495–20506 and
  20706–20717).

Therefore the current extension can faithfully transport ordinary tool
declarations and has two explicit native bridges (web search and image
generation), but it still cannot acquire the complete `agy` tool runtime just
by changing the model list or by placing native names in `request.tools`.

## Recommendation for Gaussian/Codex-style parity

### 1. Implemented in 0.14.0: explicit VS Code web-search bridge

The first bridge is now implemented as a small, intentionally scoped tool
registered through the VS Code language-model tool API:

- `antigravity_code_search` remains a future option; the installed Copilot
  build already provides `copilot_searchCodebase`, so it is not duplicated here.
- `antigravity_web_search`: starts `agy --print --output-format stream-json`,
  confines the prompt to one native `search_web` call, and returns its grounded
  markdown/source URLs.

The extension’s existing schema sanitizer, tool-name mapping, cancellation, and
tool-result round trip carry the declaration. The execution side remains in the
local UI host and does not use Gaussian’s Codex marker. The CLI must already be
authenticated; the optional `antigravity.cliPath` setting selects its executable.

`antigravity_read_url` remains unnecessary because Copilot already provides
`copilot_fetchWebPage` in the installed VS Code build.

### 2. Implemented in 0.15.0 (artifact recovery fixed in 0.15.1): explicit VS Code image-generation bridge

The second bridge exposes the native `generate_image` capability as a VS Code
tool without pretending that a function declaration alone can execute it:

- `antigravity_generate_image` starts a bounded `agy --print` sidecar and
  instructs it to make exactly one native `generate_image` call.
- The parser accepts the CLI's observed `generateImage.outputPath`/`imagePaths`
  variants, plus validated inline raster data when a future CLI emits it.
- Only PNG, JPEG, GIF, and WebP bytes within the configured size bounds are
  attached through `LanguageModelDataPart.image`.
- Artifact paths are resolved through `realpath` and restricted to the CLI's
  own `~/.gemini/antigravity*/brain` directories. Unexpected tool calls are
  rejected, the VS Code tool asks for confirmation, and the sidecar never
  receives `--dangerously-skip-permissions` (the optional CLI sandbox is not
  forced because Agy documents it only for Linux/macOS).
- Agy 1.1.26 can persist the generated JPEG in the conversation directory while
  omitting `output_path` from the headless stream. Version 0.15.1 captures the
  stream's `conversation_id` and performs a bounded, recent-file scan in that
  exact session directory, which closes the gap without broadening file access.

The tool supports optional `1:1`, `16:9`, `9:16`, `4:3`, and `3:4` aspect-ratio
hints. Input-image editing is intentionally not exposed yet because the
headless CLI's attachment contract is not stable enough to safely map into the
VS Code tool API.

### 3. Optional shared adapter: standalone MCP server

Package the same implementations as a stdio MCP server so `agy`, Antigravity
IDE, and other MCP clients can share them. Configure it in `.agents/mcp_config.json`
or the user MCP config. This is useful for portability, but the VS Code provider
still needs the caller/editor to pass those MCP tools (or an MCP client/bridge
must be implemented); the extension cannot assume that `agy`’s MCP config is
loaded into Copilot Chat.

### 4. Exact native harness (high fidelity, high coupling)

Running a long-lived `agy --input-format stream-json --output-format stream-json`
sidecar, or embedding the official Python SDK, would expose the native harness,
subagents, browser, and permission semantics. It would also create a nested
agent/second conversation, duplicate authentication and lifecycle handling, and
couple the extension to a moving CLI/SDK release. Treat this as a separate
adapter/product mode, not a small provider patch.

### Avoid

- Do not treat the 57 runtime names as a stable public API.
- Do not silently import permissive CLI settings (shell, browser, or
  non-workspace access) into VS Code.
- Do not claim `/codesearch` parity when only the explicit web/image bridges are
  wired, or claim that a tool is executable until a host-side runner exists.

## Primary sources

1. Google Antigravity SDK built-in tools: <https://antigravity.google/docs/sdk/tools.md>
2. Google Antigravity CLI headless stream contract: <https://antigravity.google/docs/cli/headless.md>
3. Google Antigravity CLI code search: <https://antigravity.google/docs/cli/commands/codesearch.md>
4. Google Antigravity MCP: <https://antigravity.google/docs/mcp.md>
5. Google Antigravity CLI features/reference: <https://antigravity.google/docs/cli/features.md>, <https://antigravity.google/docs/cli/reference.md>
6. Google Antigravity SDK enum source: <https://github.com/google-antigravity/antigravity-sdk-python/blob/main/google/antigravity/types.py#L293-L360>
7. Google Antigravity SDK `GenerateImageResult.output_path` and local event shape: <https://github.com/google-antigravity/antigravity-sdk-python/blob/main/google/antigravity/connections/local/types.py>, <https://github.com/google-antigravity/antigravity-sdk-python/blob/main/google/antigravity/connections/local/event_processor_test.py>
8. VS Code provider/tool contract: `node_modules/@types/vscode/index.d.ts` in this checkout (lines noted above).

This report is a time-bound compatibility snapshot. Re-run the headless init
probe and `agy models` after a CLI update before changing the extension’s
catalogue or tool bridge.
