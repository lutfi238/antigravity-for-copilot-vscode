import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ModelSpec } from '../src/api/models';
import { buildRequest } from '../src/translate/toGemini';
import { emitChunk, newEmitState } from '../src/translate/fromGemini';
import { SignatureCache } from '../src/translate/thinking';
import { ToolNameMap } from '../src/translate/schema';
import { GenerateContentResponse } from '../src/translate/types';

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

function build(messages: vscode.LanguageModelChatRequestMessage[], tools?: vscode.LanguageModelChatTool[]) {
	return buildRequest({
		model: GEMINI,
		messages,
		tools,
		toolMode: vscode.LanguageModelChatToolMode.Auto,
		reasoningEffort: 'off',
		signatures: new SignatureCache(),
	});
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
			type: 'OBJECT',
			properties: { q: { enum: ['fixed'], type: 'STRING' } },
		});
	});

	it('substitutes a description when the tool has none', () => {
		const { request } = build(
			[userMessage(new vscode.LanguageModelTextPart('go'))],
			[{ name: 'bare', description: '' }],
		);
		expect(request.tools?.[0].functionDeclarations?.[0].description).toBe('bare');
	});

	it('sets toolConfig mode from the requested tool mode', () => {
		const required = buildRequest({
			model: GEMINI,
			messages: [userMessage(new vscode.LanguageModelTextPart('go'))],
			tools: [{ name: 't', description: 'd' }],
			toolMode: vscode.LanguageModelChatToolMode.Required,
			reasoningEffort: 'off',
			signatures: new SignatureCache(),
		});
		expect(required.request.toolConfig?.functionCallingConfig.mode).toBe('ANY');
	});

	it('omits tools entirely when none are offered', () => {
		const { request } = build([userMessage(new vscode.LanguageModelTextPart('go'))]);
		expect(request.tools).toBeUndefined();
		expect(request.toolConfig).toBeUndefined();
	});
});

describe('buildRequest — thinking budget', () => {
	function withEffort(
		model: ModelSpec,
		reasoningEffort: 'off' | 'low' | 'medium' | 'high',
		includeThoughts = false,
	) {
		return buildRequest({
			model,
			messages: [userMessage(new vscode.LanguageModelTextPart('go'))],
			toolMode: vscode.LanguageModelChatToolMode.Auto,
			reasoningEffort,
			includeThoughts,
			signatures: new SignatureCache(),
		}).request;
	}

	it('sends Gemini a thinkingLevel only when thoughts are requested', () => {
		// Default path stays on the exact request shape known to work.
		expect(withEffort(GEMINI, 'high', false).generationConfig?.thinkingConfig).toBeUndefined();

		const opted = withEffort({ ...GEMINI, thinkingTier: 'high' }, 'high', true).generationConfig!;
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
		expect(withEffort(GEMINI, 'high').generationConfig?.thinkingConfig).toBeUndefined();
	});

	it('adds no thinkingConfig when reasoning is off', () => {
		expect(withEffort(CLAUDE, 'off').generationConfig?.thinkingConfig).toBeUndefined();
	});

	it('skips thinking for models that do not support it', () => {
		const gpt: ModelSpec = { ...CLAUDE, id: 'gpt-oss-120b-medium', family: 'gpt-oss', thinkingStyle: 'none' };
		expect(withEffort(gpt, 'high').generationConfig?.thinkingConfig).toBeUndefined();
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

	it('renders reasoning as a blockquote, since VS Code has no thinking part', () => {
		const h = harness(true);
		emitChunk(
			{
				response: {
					candidates: [
						{ content: { role: 'model', parts: [{ text: 'line one\nline two', thought: true }] } },
					],
				},
			} as GenerateContentResponse,
			h.context,
			h.state,
		);
		const text = (h.parts as vscode.LanguageModelTextPart[]).map((p) => p.value).join('');
		expect(text).toContain('**Reasoning**');
		// Continuation lines must carry the quote marker or markdown drops out of it.
		expect(text).toContain('line one\n> line two');
	});

	it('closes the blockquote once the answer starts', () => {
		const h = harness(true);
		emitChunk(
			{
				response: {
					candidates: [
						{
							content: {
								role: 'model',
								parts: [{ text: 'thinking', thought: true }, { text: 'answer' }],
							},
						},
					],
				},
			} as GenerateContentResponse,
			h.context,
			h.state,
		);
		const text = (h.parts as vscode.LanguageModelTextPart[]).map((p) => p.value).join('');
		expect(text).toMatch(/thinking\n\nanswer$/);
		expect(h.state.thinkingOpen).toBe(false);
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
