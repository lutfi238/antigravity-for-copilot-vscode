import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ModelSpec } from '../src/api/models';
import { BuildOptions, buildRequest } from '../src/translate/toGemini';
import { closeThinkingPart, createUsageDataPart, emitChunk, newEmitState } from '../src/translate/fromGemini';
import { SignatureCache } from '../src/translate/thinking';
import { ToolNameMap } from '../src/translate/schema';
import { GenerateContentResponse } from '../src/translate/types';
import { applyToolGuidance } from '../src/translate/toolGuidance';

const GEMINI: ModelSpec = {
	id: 'gemini-3.1-pro-high',
	name: 'Gemini 3.1 Pro',
	family: 'gemini',
	contextWindow: 1_048_576,
	maxOutputTokens: 65_535,
	supportsImages: true,
	thinkingStyle: 'model-id-tier',
};

const CLAUDE: ModelSpec = {
	id: 'claude-opus-4-6-thinking',
	name: 'Claude Opus 4.6 (Thinking)',
	family: 'claude',
	contextWindow: 200_000,
	maxOutputTokens: 64_000,
	supportsImages: false,
	thinkingStyle: 'numeric-budget',
};

function userMessage(...content: unknown[]): vscode.LanguageModelChatRequestMessage {
	return { role: vscode.LanguageModelChatMessageRole.User, content, name: undefined } as any;
}

function assistantMessage(...content: unknown[]): vscode.LanguageModelChatRequestMessage {
	return { role: vscode.LanguageModelChatMessageRole.Assistant, content, name: undefined } as any;
}

// Single home for defaults, so a new required BuildOptions field needs one edit here.
function buildOptions(overrides: Partial<BuildOptions> = {}): BuildOptions {
	return {
		model: GEMINI,
		messages: [],
		toolMode: vscode.LanguageModelChatToolMode.Auto,
		reasoningEffort: 'off',
		sendToolCallIds: false,
		signatures: new SignatureCache(),
		...overrides,
	};
}

function build(messages: vscode.LanguageModelChatRequestMessage[], tools?: vscode.LanguageModelChatTool[]) {
	return buildRequest(buildOptions({ messages, tools }));
}

describe('buildRequest — roles', () => {
	it('maps Assistant to "model", never "assistant"', () => {
		const { request } = build([
			userMessage(new vscode.LanguageModelTextPart('hi')),
			assistantMessage(new vscode.LanguageModelTextPart('hello')),
		]);
		expect(request.contents.map((c) => c.role)).toEqual(['user', 'model']);
	});

	it('merges consecutive same-role turns', () => {
		const { request } = build([
			userMessage(new vscode.LanguageModelTextPart('a')),
			userMessage(new vscode.LanguageModelTextPart('b')),
		]);
		expect(request.contents).toHaveLength(1);
		expect(request.contents[0].parts.map((p) => p.text)).toEqual(['a', 'b']);
	});

	it('prepends a user turn when the history opens with the model', () => {
		const { request } = build([assistantMessage(new vscode.LanguageModelTextPart('resuming'))]);
		expect(request.contents[0].role).toBe('user');
	});

	it('drops empty text parts', () => {
		const { request } = build([userMessage(new vscode.LanguageModelTextPart(''))]);
		expect(request.contents).toHaveLength(0);
	});
});

describe('buildRequest — tool round trip', () => {
	it('names a functionResponse after the call it answers', () => {
		// Gemini pairs responses to calls by name, not by id, so the callId recorded on
		// the assistant turn has to reach the user turn that carries the result.
		const { request } = build([
			userMessage(new vscode.LanguageModelTextPart('read it')),
			assistantMessage(new vscode.LanguageModelToolCallPart('call-1', 'github/read_file', { path: 'a.ts' })),
			userMessage(new vscode.LanguageModelToolResultPart('call-1', [new vscode.LanguageModelTextPart('contents')])),
		]);

		const call = request.contents[1].parts[0].functionCall;
		const response = request.contents[2].parts[0].functionResponse;
		expect(call?.name).toBe('github_read_file');
		expect(response?.name).toBe('github_read_file');
		expect(response?.response).toEqual({ output: 'contents' });
	});

	it('sanitizes declared tool names and schemas together', () => {
		const { request, names } = build(
			[userMessage(new vscode.LanguageModelTextPart('go'))],
			[
				{
					name: '1mcp/search',
					description: 'Search',
					inputSchema: { type: 'object', properties: { q: { const: 'fixed' } }, additionalProperties: false },
				},
			],
		);

		const declaration = request.tools?.[0].functionDeclarations?.[0];
		expect(declaration?.name).toBe('t_1mcp_search');
		expect(names.resolve('t_1mcp_search')).toBe('1mcp/search');
		expect(declaration?.parameters).toEqual({
			type: 'object',
			properties: { q: { enum: ['fixed'], type: 'string' } },
		});
	});

	it('does not forward Gaussian hosted-search markers to Antigravity', () => {
		const { request } = build(
			[userMessage(new vscode.LanguageModelTextPart('search'))],
			[
				{ name: 'codexForCopilot_searchWeb', description: 'Codex hosted search' },
				{ name: 'copilot_fetchWebPage', description: 'Fetch a known page' },
			],
		);

		expect(request.tools?.[0].functionDeclarations?.map((tool) => tool.name)).toEqual([
			'copilot_fetchWebPage',
		]);
	});

	it('substitutes a description when the tool has none', () => {
		const { request } = build(
			[userMessage(new vscode.LanguageModelTextPart('go'))],
			[{ name: 'bare', description: '' }],
		);
		expect(request.tools?.[0].functionDeclarations?.[0].description).toBe('bare');
	});

	it('sets toolConfig mode from the requested tool mode', () => {
		const required = buildRequest(
			buildOptions({
				messages: [userMessage(new vscode.LanguageModelTextPart('go'))],
				tools: [{ name: 't', description: 'd' }],
				toolMode: vscode.LanguageModelChatToolMode.Required,
			}),
		);
		expect(required.request.toolConfig?.functionCallingConfig.mode).toBe('ANY');
	});

	it('omits tools entirely when none are offered', () => {
		const { request } = build([userMessage(new vscode.LanguageModelTextPart('go'))]);
		expect(request.tools).toBeUndefined();
		expect(request.toolConfig).toBeUndefined();
	});
});

describe('buildRequest — efficient tool guidance', () => {
	const tools = [{ name: 'read/a', description: 'Read A' }, { name: 'read/b', description: 'Read B' }];
	const messages = [userMessage(new vscode.LanguageModelTextPart('Follow project instructions; investigate the specified file.'))];

	it.each([vscode.LanguageModelChatToolMode.Auto, vscode.LanguageModelChatToolMode.Required])(
		'only adds a system instruction, preserving messages/tools/generation and mode %s', mode => {
			const options = buildOptions({ messages, tools, toolMode: mode, model: { ...GEMINI, thinkingTier: 'high' }, reasoningEffort: 'high', includeThoughts: true });
			const before = JSON.stringify({ messages, tools });
			const baseline = buildRequest({ ...options, efficientToolUse: false });
			const guided = buildRequest({ ...options, efficientToolUse: true });
			expect(guided.toolGuidance).toBe('efficient-v1');
			expect(guided.request.systemInstruction?.parts).toHaveLength(1);
			expect(guided.request.systemInstruction?.parts[0].text?.length).toBeGreaterThan(0);
			const { systemInstruction: _guidance, ...rest } = guided.request;
			expect(rest).toEqual(baseline.request);
			expect(guided.request.toolConfig?.functionCallingConfig.mode).toBe(mode === vscode.LanguageModelChatToolMode.Required ? 'ANY' : 'AUTO');
			expect(JSON.stringify({ messages, tools })).toBe(before);
			expect(buildRequest({ ...options, efficientToolUse: true }).request).toEqual(guided.request);
			expect(buildRequest(options).request).toEqual(baseline.request);
		},
	);

	it('preserves existing system parts and adds the guidance only once', () => {
		const request = buildRequest(buildOptions({ messages, tools })).request;
		const hostInstruction = { parts: [{ text: 'Host: obey required repository validation.' }] };
		request.systemInstruction = hostInstruction;
		expect(applyToolGuidance(request, GEMINI, true)).toBe(true);
		expect(applyToolGuidance(request, GEMINI, true)).toBe(true);
		expect(request.systemInstruction.parts).toHaveLength(2);
		expect(request.systemInstruction.parts[0]).toEqual(hostInstruction.parts[0]);
		expect(hostInstruction.parts).toHaveLength(1);
	});

	it.each([CLAUDE, { ...GEMINI, family: 'gpt-oss', thinkingStyle: 'none' }, { ...GEMINI, id: 'gemini-3.1-flash-image', thinkingStyle: 'none' }] as ModelSpec[])(
		'keeps the existing request for non-target model $id', model => {
			const options = buildOptions({ messages, tools, model });
			const guided = buildRequest({ ...options, efficientToolUse: true });
			expect(guided.toolGuidance).toBe('off');
			expect(guided.request).toEqual(buildRequest(options).request);
		},
	);

	it.each([undefined, [], [{ name: 'codexForCopilot_searchWeb', description: 'Incompatible hosted marker' }]])(
		'omits guidance when no compatible tool declarations remain (%j)', offered => {
			const result = buildRequest(buildOptions({ messages, tools: offered, efficientToolUse: true }));
			expect(result.request.systemInstruction).toBeUndefined();
			expect(result.toolGuidance).toBe('off');
		},
	);

	it('round-trips multiple calls with unique ids, matching results, and thought signatures', () => {
		const signatures = new SignatureCache();
		const outgoing = buildRequest(buildOptions({ messages, tools, signatures, efficientToolUse: true }));
		const parts: any[] = [];
		const state = newEmitState();
		emitChunk({ response: { candidates: [{ content: { role: 'model', parts: [
			{ functionCall: { name: 'read_a', args: { path: 'a.ts' } }, thoughtSignature: 'sig-a' },
			{ functionCall: { name: 'read_b', args: { path: 'b.ts' } }, thoughtSignature: 'sig-b' },
		] } }] } }, { names: outgoing.names, signatures, showThinking: true, progress: { report: part => parts.push(part) } }, state);
		expect(parts).toHaveLength(2);
		expect(parts[0].callId).not.toBe(parts[1].callId);
		expect(parts.map(p => p.name)).toEqual(['read/a', 'read/b']);
		expect(state.toolCallIndex).toBe(2);
		const history = [...messages, assistantMessage(...parts), userMessage(
			new vscode.LanguageModelToolResultPart(parts[1].callId, [new vscode.LanguageModelTextPart('B result')]),
			new vscode.LanguageModelToolResultPart(parts[0].callId, [new vscode.LanguageModelTextPart('A result')]),
		)];
		const replay = buildRequest(buildOptions({ messages: history, tools, signatures, efficientToolUse: true })).request;
		expect(replay.contents[1].parts).toEqual([
			{ functionCall: { name: 'read_a', args: { path: 'a.ts' } }, thoughtSignature: 'sig-a' },
			{ functionCall: { name: 'read_b', args: { path: 'b.ts' } }, thoughtSignature: 'sig-b' },
		]);
		expect(replay.contents[2].parts.map(p => p.functionResponse)).toEqual([
			{ name: 'read_b', response: { output: 'B result' } },
			{ name: 'read_a', response: { output: 'A result' } },
		]);
		expect(replay.systemInstruction).toEqual(outgoing.request.systemInstruction);
	});
});

describe('buildRequest — realistic Agent tool set', () => {
	// A Copilot Agent turn normally offers the full built-in set plus MCP tools whose
	// names contain slashes. Every one has to survive declaration and round-trip.
	const agentTools: vscode.LanguageModelChatTool[] = [
		{ name: 'copilot_readFile', description: 'Read a file', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false } },
		{ name: 'copilot_listDirectory', description: 'List a directory', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
		{ name: 'copilot_findTextInFiles', description: 'Search text', inputSchema: { type: 'object', properties: { query: { type: 'object', properties: { pattern: { type: 'string' } } } } } },
		{ name: 'copilot_runInTerminal', description: 'Run a command', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
		{ name: 'mcp_github/search_issues', description: 'Search issues', inputSchema: { type: 'object', properties: { q: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed'] } } } },
		{ name: 'no_schema_tool', description: 'Takes no input' },
	];

	it('declares every offered tool exactly once, with a resolvable name', () => {
		const { request, names } = build([userMessage(new vscode.LanguageModelTextPart('inspect'))], agentTools);
		const declarations = request.tools?.[0]?.functionDeclarations ?? [];
		expect(declarations).toHaveLength(agentTools.length);
		expect(new Set(declarations.map((d) => d.name)).size).toBe(agentTools.length);
		for (const tool of agentTools) {
			expect(names.resolve(names.register(tool.name))).toBe(tool.name);
		}
	});

	it('keeps two tools distinct when their sanitized names collide', () => {
		// `mcp/a-b` and `mcp/a_b` both sanitize to a valid name; neither may shadow the other.
		const { request, names } = build([userMessage(new vscode.LanguageModelTextPart('go'))], [
			{ name: 'mcp/a-b', description: 'dash', inputSchema: { type: 'object', properties: {} } },
			{ name: 'mcp/a_b', description: 'underscore', inputSchema: { type: 'object', properties: {} } },
		]);
		const declarations = request.tools?.[0]?.functionDeclarations ?? [];
		expect(new Set(declarations.map((d) => d.name)).size).toBe(2);
		expect(declarations.map((d) => names.resolve(d.name))).toEqual(['mcp/a-b', 'mcp/a_b']);
	});

	it('keeps names distinct when truncation would otherwise merge them', () => {
		const long = 'x'.repeat(70);
		const { request, names } = build([userMessage(new vscode.LanguageModelTextPart('go'))], [
			{ name: `${long}_a`, description: 'A', inputSchema: { type: 'object', properties: {} } },
			{ name: `${long}_b`, description: 'B', inputSchema: { type: 'object', properties: {} } },
		]);
		const declarations = request.tools?.[0]?.functionDeclarations ?? [];
		expect(new Set(declarations.map((d) => d.name)).size).toBe(2);
		expect(declarations.map((d) => names.resolve(d.name))).toEqual([`${long}_a`, `${long}_b`]);
	});

	it('emits a distinct call id for each of several calls in one response', () => {
		const parts: unknown[] = [];
		const state = newEmitState();
		emitChunk({
			candidates: [{ content: { parts: [
				{ functionCall: { name: 'copilot_readFile', args: { filePath: 'a.ts' } } },
				{ functionCall: { name: 'copilot_readFile', args: { filePath: 'b.ts' } } },
				{ functionCall: { name: 'copilot_listDirectory', args: { path: '.' } } },
			] } }],
		} as GenerateContentResponse, {
			names: new ToolNameMap(), signatures: new SignatureCache(),
			progress: { report: (part: unknown) => parts.push(part) },
		} as any, state);
		const calls = parts.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart);
		expect(calls).toHaveLength(3);
		expect(new Set(calls.map((c) => c.callId)).size).toBe(3);
		expect(calls.map((c) => c.name)).toEqual(['copilot_readFile', 'copilot_readFile', 'copilot_listDirectory']);
	});
});

describe('buildRequest — binary tool results', () => {
	const screenshotTools: vscode.LanguageModelChatTool[] = [
		{ name: 'screenshot', description: 'Capture the screen', inputSchema: { type: 'object', properties: {} } },
	];
	const withResult = (content: unknown[]) => build([
		userMessage(new vscode.LanguageModelTextPart('capture')),
		assistantMessage(new vscode.LanguageModelToolCallPart('call_1', 'screenshot', {})),
		userMessage(new vscode.LanguageModelToolResultPart('call_1', content)),
	], screenshotTools);

	it('forwards an image from a tool result as inlineData instead of dropping it', () => {
		// `functionResponse.response` is a protobuf Struct and cannot hold bytes, so the
		// image has to ride as a sibling part. A byte-count string would hide it from the model.
		const png = new Uint8Array([137, 80, 78, 71]);
		const { request } = withResult([
			new vscode.LanguageModelTextPart('captured'),
			new vscode.LanguageModelDataPart(png, 'image/png'),
		]);
		const parts = request.contents[2].parts;
		expect(parts).toHaveLength(2);
		expect(parts[0].functionResponse?.response.output).toBe('captured');
		expect(parts[1].inlineData?.mimeType).toBe('image/png');
		expect(Buffer.from(parts[1].inlineData!.data, 'base64')).toEqual(Buffer.from(png));
	});

	it('still supplies a non-empty output when the result is image-only', () => {
		const { request } = withResult([new vscode.LanguageModelDataPart(new Uint8Array([1, 2]), 'image/jpeg')]);
		const parts = request.contents[2].parts;
		expect(parts[0].functionResponse?.response.output).toBe('(image attached)');
		expect(parts[1].inlineData?.mimeType).toBe('image/jpeg');
	});

	it('flattens text-only results into a single part with no attachment', () => {
		const { request } = withResult([new vscode.LanguageModelTextPart('body')]);
		expect(request.contents[2].parts).toHaveLength(1);
		expect(request.contents[2].parts[0].functionResponse?.response.output).toBe('body');
	});

	it('keeps an empty result non-empty', () => {
		const { request } = withResult([]);
		expect(request.contents[2].parts[0].functionResponse?.response.output).toBe('(no output)');
	});

	it('folds text-like data into the output and never as inlineData', () => {
		const { request } = withResult([new vscode.LanguageModelDataPart(new TextEncoder().encode('{"ok":true}'), 'application/json')]);
		const parts = request.contents[2].parts;
		expect(parts).toHaveLength(1);
		expect(parts[0].functionResponse?.response.output).toBe('{"ok":true}');
	});
});

describe('buildRequest — attachment count', () => {
	// The count feeds the `chat request` log, which is how image forwarding is verified
	// without a live screenshot experiment, so it must match the emitted inlineData parts.
	const png = new Uint8Array([137, 80, 78, 71]);

	it('is zero when nothing is attached', () => {
		const { attachments } = build([userMessage(new vscode.LanguageModelTextPart('hi'))]);
		expect(attachments).toBe(0);
	});

	it('counts an image sent directly in a message', () => {
		const { request, attachments } = build([
			userMessage(new vscode.LanguageModelTextPart('look'), new vscode.LanguageModelDataPart(png, 'image/png')),
		]);
		expect(attachments).toBe(1);
		const inline = request.contents.flatMap((c) => c.parts).filter((p) => p.inlineData);
		expect(inline).toHaveLength(1);
	});

	it('counts an image carried by a tool result', () => {
		const { request, attachments } = build([
			userMessage(new vscode.LanguageModelTextPart('capture')),
			assistantMessage(new vscode.LanguageModelToolCallPart('call_1', 'shot', {})),
			userMessage(new vscode.LanguageModelToolResultPart('call_1', [
				new vscode.LanguageModelTextPart('ok'),
				new vscode.LanguageModelDataPart(png, 'image/png'),
			])),
		], [{ name: 'shot', description: 'shot', inputSchema: { type: 'object', properties: {} } }]);
		expect(attachments).toBe(1);
		const inline = request.contents.flatMap((c) => c.parts).filter((p) => p.inlineData);
		expect(inline).toHaveLength(1);
	});

	it('counts several attachments across messages and tool results', () => {
		const { attachments } = build([
			userMessage(new vscode.LanguageModelTextPart('two images'), new vscode.LanguageModelDataPart(png, 'image/png')),
			assistantMessage(new vscode.LanguageModelToolCallPart('call_1', 'shot', {})),
			userMessage(new vscode.LanguageModelToolResultPart('call_1', [
				new vscode.LanguageModelDataPart(png, 'image/jpeg'),
				new vscode.LanguageModelDataPart(new Uint8Array([1]), 'image/webp'),
			])),
		], [{ name: 'shot', description: 'shot', inputSchema: { type: 'object', properties: {} } }]);
		expect(attachments).toBe(3);
	});

	it('does not count text-like data, which folds into output', () => {
		const { attachments } = build([
			userMessage(new vscode.LanguageModelTextPart('x')),
			assistantMessage(new vscode.LanguageModelToolCallPart('call_1', 'read', {})),
			userMessage(new vscode.LanguageModelToolResultPart('call_1', [
				new vscode.LanguageModelDataPart(new TextEncoder().encode('{"ok":true}'), 'application/json'),
			])),
		], [{ name: 'read', description: 'read', inputSchema: { type: 'object', properties: {} } }]);
		expect(attachments).toBe(0);
	});

	it('does not count the internal usage data part', () => {
		const { attachments } = build([
			userMessage(new vscode.LanguageModelTextPart('x'), new vscode.LanguageModelDataPart(new Uint8Array([1]), 'usage')),
		]);
		expect(attachments).toBe(0);
	});
});

describe('buildRequest — tool call ids', () => {
	function buildWithIds(model: ModelSpec, sendToolCallIds: boolean) {
		return buildRequest(
			buildOptions({
				model,
				messages: [
					userMessage(new vscode.LanguageModelTextPart('read it')),
					assistantMessage(new vscode.LanguageModelToolCallPart('call-1', 'github/read_file', { path: 'a.ts' })),
					userMessage(new vscode.LanguageModelToolResultPart('call-1', [new vscode.LanguageModelTextPart('contents')])),
				],
				sendToolCallIds,
			}),
		).request;
	}

	it('forwards the call id on both the call and its result when enabled', () => {
		const request = buildWithIds(CLAUDE, true);
		const call = request.contents[1].parts[0].functionCall;
		const response = request.contents[2].parts[0].functionResponse;
		expect(call?.id).toBe('call-1');
		expect(response?.id).toBe('call-1');
	});

	it('omits the id key entirely when disabled', () => {
		const request = buildWithIds(CLAUDE, false);
		const call = request.contents[1].parts[0].functionCall!;
		const response = request.contents[2].parts[0].functionResponse!;
		expect('id' in call).toBe(false);
		expect('id' in response).toBe(false);
	});

	it('omits the id when the call id is empty', () => {
		const request = buildRequest(
			buildOptions({
				model: CLAUDE,
				messages: [
					userMessage(new vscode.LanguageModelTextPart('go')),
					assistantMessage(new vscode.LanguageModelToolCallPart('', 'github/read_file', {})),
				],
				sendToolCallIds: true,
			}),
		).request;
		const call = request.contents.flatMap((c) => c.parts).find((p) => p.functionCall)!.functionCall!;
		expect('id' in call).toBe(false);
	});
});

describe('buildRequest — thinking budget', () => {
	function withEffort(
		model: ModelSpec,
		reasoningEffort: 'off' | 'low' | 'medium' | 'high',
		includeThoughts = false,
	) {
		return buildRequest(
			buildOptions({
				model,
				messages: [userMessage(new vscode.LanguageModelTextPart('go'))],
				reasoningEffort,
				includeThoughts,
			}),
		).request;
	}

	it('sends Gemini a thinkingLevel only when thoughts are requested', () => {
		// The tier lives in the id, so hiding thoughts keeps the exact request shape known
		// to work. (A tierless route forwards the picker's choice instead — see below.)
		const tiered = { ...GEMINI, thinkingTier: 'high' as const };
		expect(withEffort(tiered, 'high', false).generationConfig?.thinkingConfig).toBeUndefined();

		const opted = withEffort(tiered, 'high', true).generationConfig!;
		expect(opted.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'high' });
		// Never a numeric budget for Gemini — it takes a level string.
		expect(opted.thinkingConfig!.thinkingBudget).toBeUndefined();
	});

	it('lets Claude keep its budget while toggling thought visibility', () => {
		const off = withEffort(CLAUDE, 'high', false).generationConfig!.thinkingConfig!;
		const on = withEffort(CLAUDE, 'high', true).generationConfig!.thinkingConfig!;
		expect(off.includeThoughts).toBe(false);
		expect(on.includeThoughts).toBe(true);
		expect(on.thinkingBudget).toBe(off.thinkingBudget);
	});

	it('keeps a Claude budget strictly below maxOutputTokens, as the gateway demands', () => {
		const config = withEffort(CLAUDE, 'high').generationConfig!;
		expect(config.thinkingConfig!.thinkingBudget).toBeLessThan(config.maxOutputTokens!);
	});

	it('sends no thinkingConfig to Gemini 3 — the tier lives in the model id', () => {
		// Gemini 3 takes a `thinkingLevel` string, not a budget, and picks it from the
		// `-high` / `-low` suffix. A numeric budget here is wrong at best.
		expect(withEffort({ ...GEMINI, thinkingTier: 'high' }, 'high').generationConfig?.thinkingConfig)
			.toBeUndefined();
	});

	it('adds no thinkingConfig when reasoning is off', () => {
		expect(withEffort(CLAUDE, 'off').generationConfig?.thinkingConfig).toBeUndefined();
	});

	it('skips thinking for models that do not support it', () => {
		const gpt: ModelSpec = { ...CLAUDE, id: 'gpt-oss-120b-medium', family: 'gpt-oss', thinkingStyle: 'none' };
		expect(withEffort(gpt, 'high').generationConfig?.thinkingConfig).toBeUndefined();
	});

	it('forwards the picker effort for a discovered route whose id carries no tier', () => {
		// `gemini-4-hydrogen-sonar` is a live example: discovery returns it with no tier
		// suffix, so `thinkingTier` is undefined. Reading the level only from the id sent
		// no `thinkingLevel` at all, silently dropping the user's choice — the log said
		// `effort=medium` while the wire carried nothing.
		const sonar: ModelSpec = {
			...GEMINI, id: 'gemini-4-hydrogen-sonar', name: 'Gemini 4 Hydrogen Sonar', thinkingTier: undefined,
		};
		const config = withEffort(sonar, 'medium', true).generationConfig!;
		expect(config.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'medium' });
	});

	it('still prefers the id tier when the id does publish one', () => {
		// A tiered id must not be overridden by the picker: the id is the route, and the
		// gateway addresses each tier as its own model.
		const config = withEffort({ ...GEMINI, thinkingTier: 'low' }, 'xhigh', true).generationConfig!;
		expect(config.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'low' });
	});

	it('sends no level for an untiered route when effort is off', () => {
		const sonar: ModelSpec = { ...GEMINI, id: 'gemini-4-hydrogen-sonar', thinkingTier: undefined };
		expect(withEffort(sonar, 'off', true).generationConfig?.thinkingConfig).toEqual({ includeThoughts: true });
	});

	it('never forwards an effort to a fixed-configuration model', () => {
		// Orchestrator publishes no tier and runs a fixed configuration. Without the guard
		// it took the untiered fallback and silently received the global default level —
		// the exact wire change the picker withholds a control for.
		const orchestrator: ModelSpec = {
			...GEMINI, id: 'gemini-pro-orchestrator-g1-pro', name: 'Orchestrator (Argon)',
			thinkingTier: undefined, fixedEffort: true,
		};
		const config = withEffort(orchestrator, 'high', true).generationConfig!;
		expect(config.thinkingConfig).toEqual({ includeThoughts: true });
		expect(config.thinkingConfig!.thinkingLevel).toBeUndefined();
	});

	it('keeps the picker effort for a tierless route when reasoning is hidden', () => {
		// Visibility and control are separate. `showThinking=false` must not silently
		// disable the effort the picker still offers on a route with no tier in its id.
		const sonar: ModelSpec = { ...GEMINI, id: 'gemini-4-hydrogen-sonar', thinkingTier: undefined };
		const config = withEffort(sonar, 'xhigh', false).generationConfig!;
		expect(config.thinkingConfig).toEqual({ thinkingLevel: 'xhigh' });
		// The thoughts themselves stay hidden.
		expect(config.thinkingConfig!.includeThoughts).toBeUndefined();
	});

	it('keeps a tiered id on its previous wire shape when reasoning is hidden', () => {
		// The tier rides on the id, so hiding thoughts must not add a field the request
		// did not previously carry.
		expect(withEffort({ ...GEMINI, thinkingTier: 'high' }, 'high', false).generationConfig?.thinkingConfig)
			.toBeUndefined();
	});

	it('keeps fixedEffort silent even with reasoning hidden', () => {
		const orchestrator: ModelSpec = {
			...GEMINI, id: 'gemini-pro-orchestrator-g1-pro', thinkingTier: undefined, fixedEffort: true,
		};
		expect(withEffort(orchestrator, 'high', false).generationConfig?.thinkingConfig).toBeUndefined();
	});
});

describe('emitChunk', () => {
	function harness(showThinking = false) {
		const parts: unknown[] = [];
		const names = new ToolNameMap();
		names.register('github/read_file');
		return {
			parts,
			names,
			context: {
				names,
				signatures: new SignatureCache(),
				showThinking,
				progress: { report: (part: unknown) => parts.push(part) },
			} as any,
			state: newEmitState(),
		};
	}

	it('emits text parts', () => {
		const h = harness();
		emitChunk({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] } } as GenerateContentResponse, h.context, h.state);
		expect(h.parts).toEqual([new vscode.LanguageModelTextPart('hi')]);
	});

	it('reads candidates from an unwrapped envelope too', () => {
		const h = harness();
		emitChunk({ candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] } as GenerateContentResponse, h.context, h.state);
		expect(h.parts).toHaveLength(1);
	});

	it('resolves a tool call back to the VS Code tool name', () => {
		const h = harness();
		emitChunk(
			{
				response: {
					candidates: [
						{ content: { role: 'model', parts: [{ functionCall: { name: 'github_read_file', args: { path: 'a' } } }] } },
					],
				},
			} as GenerateContentResponse,
			h.context,
			h.state,
		);
		const call = h.parts[0] as vscode.LanguageModelToolCallPart;
		expect(call.name).toBe('github/read_file');
		expect(call.input).toEqual({ path: 'a' });
	});

	it('issues a distinct callId per tool call', () => {
		const h = harness();
		const chunk = {
			response: {
				candidates: [
					{
						content: {
							role: 'model',
							parts: [{ functionCall: { name: 'github_read_file' } }, { functionCall: { name: 'github_read_file' } }],
						},
					},
				],
			},
		} as GenerateContentResponse;
		emitChunk(chunk, h.context, h.state);
		const [a, b] = h.parts as vscode.LanguageModelToolCallPart[];
		expect(a.callId).not.toBe(b.callId);
	});

	it('caches a thought signature against the call it arrived with', () => {
		const h = harness();
		emitChunk(
			{
				response: {
					candidates: [
						{
							content: {
								role: 'model',
								parts: [{ functionCall: { name: 'github_read_file' }, thoughtSignature: 'sig-abc' }],
							},
						},
					],
				},
			} as GenerateContentResponse,
			h.context,
			h.state,
		);
		const call = h.parts[0] as vscode.LanguageModelToolCallPart;
		expect(h.context.signatures.get(call.callId)).toBe('sig-abc');
	});

	it('hides reasoning text by default', () => {
		const h = harness(false);
		emitChunk(
			{ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'reasoning', thought: true }] } }] } } as GenerateContentResponse,
			h.context,
			h.state,
		);
		expect(h.parts).toHaveLength(0);
	});

	it('records the finish reason and usage', () => {
		const h = harness();
		emitChunk(
			{
				response: {
					candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [] } }],
					usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
				},
			} as GenerateContentResponse,
			h.context,
			h.state,
		);
		expect(h.state.finishReason).toBe('MAX_TOKENS');
		expect(h.state.usage?.promptTokenCount).toBe(10);
	});

	it('serializes gateway usage as the VS Code usage data part', () => {
		const part = createUsageDataPart({
			promptTokenCount: 42_400,
			candidatesTokenCount: 1_200,
			thoughtsTokenCount: 300,
			totalTokenCount: 43_900,
			cachedContentTokenCount: 4_000,
		});

		expect(part).toBeInstanceOf(vscode.LanguageModelDataPart);
		expect(part?.mimeType).toBe('usage');
		expect(JSON.parse(Buffer.from(part!.data).toString('utf8'))).toEqual({
			prompt_tokens: 42_400,
			completion_tokens: 1_500,
			total_tokens: 43_900,
			prompt_tokens_details: { cached_tokens: 4_000 },
			completion_tokens_details: { reasoning_tokens: 300 },
		});
	});

	it('keeps usage fields when the gateway fills them across stream chunks', () => {
		const h = harness();
		emitChunk(
			{ response: { usageMetadata: { promptTokenCount: 42_400 } } } as GenerateContentResponse,
			h.context,
			h.state,
		);
		emitChunk(
			{
				response: {
					usageMetadata: {
						candidatesTokenCount: 1_200,
						thoughtsTokenCount: 300,
						totalTokenCount: 43_900,
					},
				},
			} as GenerateContentResponse,
			h.context,
			h.state,
		);

		const part = createUsageDataPart(h.state.usage);
		expect(JSON.parse(Buffer.from(part!.data).toString('utf8'))).toMatchObject({
			prompt_tokens: 42_400,
			completion_tokens: 1_500,
			total_tokens: 43_900,
		});
	});
});

describe('internal usage replay', () => {
	it('does not send the usage data part back to Gemini as inline data', () => {
		const usage = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(JSON.stringify({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 })),
			'usage',
		);
		const { request } = build([assistantMessage(usage)]);

		expect(request.contents).toEqual([]);
	});
});

describe('SignatureCache', () => {
	it('evicts the oldest entry past its limit', () => {
		const cache = new SignatureCache();
		for (let i = 0; i < 520; i++) {
			cache.set(`k${i}`, `s${i}`);
		}
		expect(cache.get('k0')).toBeUndefined();
		expect(cache.get('k519')).toBe('s519');
	});
});

describe('reasoning rendering', () => {
	function harness(showThinking: boolean) {
		const parts: unknown[] = [];
		return {
			parts,
			context: {
				names: new ToolNameMap(),
				signatures: new SignatureCache(),
				showThinking,
				progress: { report: (p: unknown) => parts.push(p) },
			} as any,
			state: newEmitState(),
		};
	}

	const thoughtChunk = (text: string) =>
		({
			response: { candidates: [{ content: { role: 'model', parts: [{ text, thought: true }] } }] },
		}) as GenerateContentResponse;

	it('emits a native thinking part when the runtime provides one', () => {
		const h = harness(true);
		emitChunk(thoughtChunk('weighing options'), h.context, h.state);
		expect(h.parts).toHaveLength(1);
		expect(h.parts[0]).toBeInstanceOf((vscode as any).LanguageModelThinkingPart);
		expect((h.parts[0] as any).value).toBe('weighing options');
	});

	it('groups streamed reasoning under one id so it renders as a single block', () => {
		const h = harness(true);
		emitChunk(thoughtChunk('first'), h.context, h.state);
		emitChunk(thoughtChunk('second'), h.context, h.state);
		const ids = (h.parts as any[]).map((p) => p.id);
		expect(ids[0]).toBeDefined();
		expect(ids[0]).toBe(ids[1]);
	});

	it('closes the native thinking block before answer text', () => {
		const h = harness(true);
		emitChunk(thoughtChunk('weighing options'), h.context, h.state);
		emitChunk(
			({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'answer' }] } }] } }) as GenerateContentResponse,
			h.context,
			h.state,
		);

		expect(h.parts).toHaveLength(3);
		const [, done, answer] = h.parts as any[];
		expect(done).toBeInstanceOf((vscode as any).LanguageModelThinkingPart);
		expect(done.value).toBe('');
		expect(done.id).toBe('');
		expect(done.metadata).toEqual({ vscode_reasoning_done: true });
		expect(answer).toBeInstanceOf(vscode.LanguageModelTextPart);
	});

	it('closes the native thinking block before a tool call', () => {
		const h = harness(true);
		emitChunk(thoughtChunk('checking the workspace'), h.context, h.state);
		emitChunk(
			({
				response: {
					candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'a' } } }] } }],
				},
			}) as GenerateContentResponse,
			h.context,
			h.state,
		);

		expect(h.parts).toHaveLength(3);
		expect((h.parts[1] as any).metadata).toEqual({ vscode_reasoning_done: true });
		expect(h.parts[2]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
	});

	it('can close a trailing thinking block when the stream has no answer part', () => {
		const h = harness(true);
		emitChunk(thoughtChunk('final internal check'), h.context, h.state);
		closeThinkingPart(h.context, h.state);
		closeThinkingPart(h.context, h.state);

		expect(h.parts).toHaveLength(2);
		expect((h.parts[1] as any).metadata).toEqual({ vscode_reasoning_done: true });
		expect(h.state.thinkingOpen).toBe(false);
	});

	it('falls back to a blockquote when the runtime has no thinking part', () => {
		const ctor = (vscode as any).LanguageModelThinkingPart;
		delete (vscode as any).LanguageModelThinkingPart;
		try {
			const h = harness(true);
			emitChunk(thoughtChunk('line one\nline two'), h.context, h.state);
			const text = (h.parts as vscode.LanguageModelTextPart[]).map((p) => p.value).join('');
			expect(text).toContain('**Reasoning**');
			expect(text).toContain('line one\n> line two');
		} finally {
			(vscode as any).LanguageModelThinkingPart = ctor;
		}
	});

	it('emits nothing at all when reasoning is turned off', () => {
		const h = harness(false);
		emitChunk(thoughtChunk('hidden'), h.context, h.state);
		expect(h.parts).toHaveLength(0);
	});
});

describe('thought-part accounting', () => {
	function harness(showThinking: boolean) {
		const parts: unknown[] = [];
		return {
			parts,
			context: {
				names: new ToolNameMap(),
				signatures: new SignatureCache(),
				showThinking,
				progress: { report: (p: unknown) => parts.push(p) },
			} as any,
			state: newEmitState(),
		};
	}

	const chunk = (parts: unknown[]) =>
		({ response: { candidates: [{ content: { role: 'model', parts } }] } }) as GenerateContentResponse;

	it('counts thought parts even when reasoning is hidden', () => {
		// The count has to reflect what the gateway sent, not what was rendered, or it
		// cannot answer "did the model return thoughts at all?".
		const h = harness(false);
		emitChunk(chunk([{ text: 'a', thought: true }, { text: 'b', thought: true }]), h.context, h.state);
		expect(h.state.thoughtParts).toBe(2);
		expect(h.parts).toHaveLength(0);
	});

	it('stays at zero when the stream carries only answer text', () => {
		const h = harness(true);
		emitChunk(chunk([{ text: 'just the answer' }]), h.context, h.state);
		expect(h.state.thoughtParts).toBe(0);
	});
});
