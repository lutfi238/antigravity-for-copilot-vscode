import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AntigravityProvider } from '../src/provider';

function sseResponse(payload: unknown): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`));
			controller.close();
		},
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('AntigravityProvider', () => {
	// config.toolCallIds() reads through the shared vscode stub.
	const settings: Record<string, unknown> = {};
	const getConfiguration = (vscode.workspace as any).getConfiguration;

	beforeEach(() => {
		(vscode.workspace as any).getConfiguration = () => ({ get: (key: string) => settings[key] });
	});

	afterEach(() => {
		(vscode.workspace as any).getConfiguration = getConfiguration;
		delete settings.toolCallIds;
	});

	it('forwards completed gateway usage to VS Code after the SSE stream', async () => {
		const client = {
			post: vi.fn().mockResolvedValue(
				sseResponse({
					response: {
						candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] } }],
						usageMetadata: {
							promptTokenCount: 42_400,
							candidatesTokenCount: 1_200,
							thoughtsTokenCount: 300,
							totalTokenCount: 43_900,
						},
					},
				}),
			),
		} as any;
		const store = {
			onDidChange: () => ({ dispose() {} }),
			active: vi.fn().mockResolvedValue({ email: 'test@example.com', refreshToken: 'test-refresh-token' }),
		} as any;
		const projects = { resolve: vi.fn().mockResolvedValue('project') } as any;
		const statusBar = { update: vi.fn(), setSignedOut: vi.fn() } as any;
		const context = { subscriptions: [] } as any;
		const provider = new AntigravityProvider(context, store, {} as any, client, projects, statusBar);
		const parts: unknown[] = [];
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		} as any;

		await provider.provideLanguageModelChatResponse(
			{
				id: 'gemini-3.8-flash-medium',
				name: 'Gemini 3.8 Flash (Medium)',
				family: 'gemini',
				version: '1.0.0',
				maxInputTokens: 983_040,
				maxOutputTokens: 65_536,
			} as vscode.LanguageModelChatInformation,
			[{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('hello')], name: undefined }],
			{ modelOptions: {}, tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
			{ report: (part: unknown) => parts.push(part) },
			token,
		);

		const usagePart = parts.find(
			(part): part is vscode.LanguageModelDataPart =>
				part instanceof vscode.LanguageModelDataPart && part.mimeType === 'usage',
		);
		expect(usagePart).toBeDefined();
		expect(JSON.parse(Buffer.from(usagePart!.data).toString('utf8'))).toMatchObject({
			prompt_tokens: 42_400,
			completion_tokens: 1_500,
			total_tokens: 43_900,
		});
		expect(parts.filter((part) => part instanceof vscode.LanguageModelTextPart)).toHaveLength(1);
	});

	it('keeps synthesized tool call ids unique across response invocations', async () => {
		const client = {
			post: vi.fn().mockImplementation(() =>
				Promise.resolve(
					sseResponse({
						response: {
							candidates: [
								{
									content: {
										role: 'model',
										parts: [{ functionCall: { name: 'view', args: { path: 'README.md' } } }],
									},
								},
							],
							usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
						},
					}),
				),
			),
		} as any;
		const store = {
			onDidChange: () => ({ dispose() {} }),
			active: vi.fn().mockResolvedValue({ email: 'test@example.com', refreshToken: 'test-refresh-token' }),
		} as any;
		const projects = { resolve: vi.fn().mockResolvedValue('project') } as any;
		const provider = new AntigravityProvider(
			{ subscriptions: [] } as any,
			store,
			{} as any,
			client,
			projects,
			{ update: vi.fn(), setSignedOut: vi.fn() } as any,
		);
		const parts: unknown[] = [];
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		} as any;
		const model = {
			id: 'gemini-3.8-flash-medium',
			name: 'Gemini 3.8 Flash (Medium)',
			family: 'gemini',
			version: '1.0.0',
			maxInputTokens: 983_040,
			maxOutputTokens: 65_536,
		} as vscode.LanguageModelChatInformation;
		const options = {
			modelOptions: {},
			tools: [{ name: 'view', description: 'View a file' }],
			toolMode: vscode.LanguageModelChatToolMode.Auto,
		} as vscode.ProvideLanguageModelChatResponseOptions;

		for (let attempt = 0; attempt < 2; attempt++) {
			await provider.provideLanguageModelChatResponse(
				model,
				[
					{
						role: vscode.LanguageModelChatMessageRole.User,
						content: [new vscode.LanguageModelTextPart('read it')],
						name: undefined,
					},
				],
				options,
				{ report: (part: unknown) => parts.push(part) },
				token,
			);
		}

		const calls = parts.filter(
			(part): part is vscode.LanguageModelToolCallPart => part instanceof vscode.LanguageModelToolCallPart,
		);
		expect(calls).toHaveLength(2);
		expect(calls[0].callId).not.toBe(calls[1].callId);
	});

	it('gates tool-call id forwarding on the toolCallIds setting', async () => {
		const bodies: any[] = [];
		const client = {
			post: vi.fn().mockImplementation((options: any) => {
				bodies.push(options.body);
				return Promise.resolve(
					sseResponse({
						response: {
							candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
							usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
						},
					}),
				);
			}),
		} as any;
		const store = {
			onDidChange: () => ({ dispose() {} }),
			active: vi.fn().mockResolvedValue({ email: 'test@example.com', refreshToken: 'test-refresh-token' }),
		} as any;
		const projects = { resolve: vi.fn().mockResolvedValue('project') } as any;
		const provider = new AntigravityProvider(
			{ subscriptions: [] } as any,
			store,
			{} as any,
			client,
			projects,
			{ update: vi.fn(), setSignedOut: vi.fn() } as any,
		);
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		} as any;
		const options = {
			modelOptions: {},
			tools: [{ name: 'view', description: 'View a file' }],
			toolMode: vscode.LanguageModelChatToolMode.Auto,
		} as vscode.ProvideLanguageModelChatResponseOptions;
		const messages = [
			{
				role: vscode.LanguageModelChatMessageRole.User,
				content: [new vscode.LanguageModelTextPart('read it')],
				name: undefined,
			},
			{
				role: vscode.LanguageModelChatMessageRole.Assistant,
				content: [new vscode.LanguageModelToolCallPart('call-1', 'view', { path: 'a.ts' })],
				name: undefined,
			},
			{
				role: vscode.LanguageModelChatMessageRole.User,
				content: [new vscode.LanguageModelToolResultPart('call-1', [new vscode.LanguageModelTextPart('contents')])],
				name: undefined,
			},
		] as any;

		const sendToolIds = (body: any) =>
			body.request.contents.flatMap((c: any) => c.parts).find((p: any) => p.functionCall)?.functionCall;

		const run = async (toolCallIds?: string) => {
			if (toolCallIds === undefined) {
				delete settings.toolCallIds;
			} else {
				settings.toolCallIds = toolCallIds;
			}
			bodies.length = 0;
			for (const id of ['claude-sonnet-4-6', 'gemini-3.8-flash-medium']) {
				await provider.provideLanguageModelChatResponse(
					{ id, name: id, family: id.startsWith('claude') ? 'claude' : 'gemini', version: '1.0.0', maxInputTokens: 1000, maxOutputTokens: 1000 } as vscode.LanguageModelChatInformation,
					messages,
					options,
					{ report: () => {} },
					token,
				);
			}
			expect(bodies).toHaveLength(2);
			return { claude: sendToolIds(bodies[0]), gemini: sendToolIds(bodies[1]) };
		};

		const dflt = await run(undefined);
		expect(dflt.claude).toBeDefined();
		expect(dflt.gemini).toBeDefined();
		expect(dflt.claude.id).toBe('call-1');
		expect('id' in dflt.gemini).toBe(false);

		const off = await run('off');
		expect('id' in off.claude).toBe(false);
		expect('id' in off.gemini).toBe(false);

		const all = await run('all');
		expect(all.claude.id).toBe('call-1');
		expect(all.gemini.id).toBe('call-1');
	});
});
