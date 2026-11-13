import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AntigravityProvider } from '../src/provider';
import { log } from '../src/log';
import { config } from '../src/config';
import { AccountPlan } from '../src/api/accountPlan';
import { GeminiQuota } from '../src/api/geminiQuota';

describe('background Gemini quota windows', () => {
	afterEach(() => vi.restoreAllMocks());
	function harness() {
		let finish!: (quota: GeminiQuota) => void;
		const pending = new Promise<GeminiQuota>(resolve => { finish = resolve; });
		const account = { email: 'first@example.invalid', refreshToken: 'synthetic' };
		const store = { active: vi.fn().mockResolvedValue(account), onDidChange: () => ({ dispose() {} }) };
		const summaries = { peek: vi.fn(), get: vi.fn().mockReturnValue(pending), invalidate: vi.fn() };
		const status = { update: vi.fn(), setGeminiQuota: vi.fn(), setLoading: vi.fn(), setSignedOut: vi.fn() };
		const client = { postJson: vi.fn().mockResolvedValue({ models: { 'gemini-3.8-flash-high': {} } }) };
		const context = { subscriptions: [] as vscode.Disposable[] };
		const provider = new AntigravityProvider(context as any, store as any, {} as any, client as any,
			{ resolve: async () => 'synthetic-project' } as any, status as any, undefined, undefined, summaries as any);
		return { provider, store, account, summaries, status, finish, context,
			discover: () => provider.provideLanguageModelChatInformation({ silent: true }, {} as any) };
	}

	it('returns models without waiting for quota and then updates only the captured account', async () => {
		const h = harness();
		expect(await h.discover()).toHaveLength(1);
		expect(h.summaries.get).toHaveBeenCalledWith(h.account);
		expect(h.status.setGeminiQuota).not.toHaveBeenCalled();
		h.finish({ fiveHour: { remainingFraction: .9 }, weekly: { remainingFraction: .5 } });
		await Promise.resolve();
		expect(h.status.setGeminiQuota).toHaveBeenCalledExactlyOnceWith(h.account.email,
			{ fiveHour: { remainingFraction: .9 }, weekly: { remainingFraction: .5 } });
	});

	it('passes cached windows to the initial status update', async () => {
		const h = harness();
		const cached = { weekly: { remainingFraction: .5 } };
		h.summaries.peek.mockReturnValue(cached);
		await h.discover();
		expect(h.status.update).toHaveBeenCalledWith(expect.anything(), h.account.email,
			expect.objectContaining({ geminiQuota: cached }));
	});

	it.each(['refresh', 'switch', 'signout', 'dispose'])('ignores late quota after %s', async action => {
		const h = harness();
		await h.discover();
		if (action === 'dispose') {
			for (const subscription of h.context.subscriptions) subscription.dispose();
		} else {
			h.provider.refresh();
			expect(h.summaries.invalidate).toHaveBeenCalledOnce();
			if (action === 'switch') h.store.active.mockResolvedValue({ ...h.account, email: 'second@example.invalid' });
			if (action === 'signout') h.store.active.mockResolvedValue(undefined);
			if (action !== 'refresh') await h.discover();
		}
		h.finish({ weekly: { remainingFraction: .5 } });
		await Promise.resolve();
		expect(h.status.setGeminiQuota.mock.calls.some(([email]) => email === h.account.email)).toBe(false);
	});
});

describe('account plan discovery', () => {
	afterEach(() => vi.restoreAllMocks());
	function harness() {
		let finish!: (plan: AccountPlan) => void;
		const pending = new Promise<AccountPlan>(resolve => { finish = resolve; });
		const account = { email: 'first@example.invalid', refreshToken: 'synthetic' };
		const store = { active: vi.fn().mockResolvedValue(account), onDidChange: () => ({ dispose() {} }) };
		const plans = { peek: vi.fn(), get: vi.fn().mockReturnValue(pending), invalidate: vi.fn() };
		const status = { update: vi.fn(), setPlan: vi.fn(), setLoading: vi.fn(), setSignedOut: vi.fn() };
		const client = { postJson: vi.fn().mockResolvedValue({ models: {
			'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)' },
			'gemini-3.8-flash-low': { displayName: 'Gemini 3.8 Flash (Low)' },
			'gemini-3-flash': { displayName: 'Gemini 3 Flash' },
			'gpt-oss-120b-medium': { displayName: 'GPT-OSS 120B (Medium)' },
		} }) };
		const context = { subscriptions: [] as vscode.Disposable[] };
		const provider = new AntigravityProvider(context as any, store as any, {} as any,
			client as any, { resolve: async () => 'synthetic-project' } as any, status as any, undefined, plans as any);
		return { provider, store, account, plans, status, client, finish, context,
			discover: () => provider.provideLanguageModelChatInformation({ silent: true }, {} as any) };
	}

	it('returns curated models while plan is pending and reports the actual picker count', async () => {
		vi.spyOn(config, 'hiddenModels').mockReturnValue(['gpt-oss-120b-medium']);
		const h = harness();
		const models = await h.discover();
		expect(models).toHaveLength(1);
		expect(h.status.update).toHaveBeenCalledWith(expect.anything(), h.account.email,
			expect.objectContaining({ modelCount: 1, plan: undefined }));
		expect(h.client.postJson).toHaveBeenCalledWith(expect.objectContaining({ account: h.account }));
		expect(h.status.setPlan).not.toHaveBeenCalled();
		h.finish({ label: 'Pro' });
		await Promise.resolve();
		expect(h.status.setPlan).toHaveBeenCalledExactlyOnceWith(h.account.email, { label: 'Pro' });
	});

	it.each(['refresh', 'switch', 'signout', 'dispose'])('ignores late plan results after %s', async action => {
		const h = harness();
		await h.discover();
		if (action === 'dispose') {
			for (const subscription of h.context.subscriptions) subscription.dispose();
		} else {
			h.provider.refresh(); // Store changes are wired to refresh in the constructor.
			if (action === 'switch') h.store.active.mockResolvedValue({ ...h.account, email: 'second@example.invalid' });
			if (action === 'signout') h.store.active.mockResolvedValue(undefined);
			if (action !== 'refresh') await h.discover();
		}
		h.finish({ label: 'Pro' });
		await Promise.resolve();
		expect(h.status.setPlan.mock.calls.some(([email]) => email === h.account.email)).toBe(false);
	});

	it('discards a discovery result when the active account changes during the request', async () => {
		const h = harness();
		h.store.active.mockResolvedValueOnce(h.account).mockResolvedValue({ ...h.account, email: 'second@example.invalid' });
		expect(await h.discover()).toEqual([]);
		expect(h.status.update).not.toHaveBeenCalled();
		expect(h.plans.get).not.toHaveBeenCalled();
	});
});

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
		for (const key of Object.keys(settings)) delete settings[key];
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

class TestToken {
	isCancellationRequested = false;
	readonly listeners = new Set<() => void>();
	onCancellationRequested = (listener: () => void) => {
		if (this.isCancellationRequested) {
			const timer = setTimeout(listener, 0);
			return { dispose: () => clearTimeout(timer) };
		}
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	};
	cancel() {
		this.isCancellationRequested = true;
		for (const listener of [...this.listeners]) listener();
	}
}

describe('provider effort, cancellation and latency diagnostics', () => {
	const settings: Record<string, unknown> = {};
	beforeEach(() => {
		vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({ get: (key: string) => settings[key] }) as any);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		for (const key of Object.keys(settings)) delete settings[key];
	});

	function harness(tiers = ['high', 'medium', 'low'], tools: vscode.LanguageModelChatTool[] = []) {
		const client = {
			postJson: vi.fn().mockResolvedValue({ models: Object.fromEntries(tiers.map(tier => [
				`gemini-3.8-flash-${tier}`, { displayName: `Gemini 3.8 Flash (${tier})` },
			])) }),
			post: vi.fn().mockImplementation(async () => sseResponse({ response: {
				candidates: [{ content: { parts: [{ text: 'done' }] } }],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 7 },
			} })),
		};
		const projects = { resolve: vi.fn().mockResolvedValue('synthetic-project') };
		const provider = new AntigravityProvider({ subscriptions: [] } as any,
			{ onDidChange: () => ({ dispose() {} }), active: async () => ({ email: 'test@example.invalid' }) } as any,
			{} as any, client as any, projects as any, { update() {} } as any);
		const token = new TestToken();
		const reports: any[] = [];
		const fallback = { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash', maxOutputTokens: 65536 } as any;
		const send = (info = fallback, effort = 'low', report = (part: any) => reports.push(part)) =>
			provider.provideLanguageModelChatResponse(info,
				[{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('PRIVATE_PROMPT')], name: undefined }],
				{ tools, modelConfiguration: { reasoningEffort: effort } } as any, { report }, token);
		return { provider, client, projects, token, reports, send,
			discover: () => provider.provideLanguageModelChatInformation({ silent: true }, token) };
	}

	it.each([true, false].flatMap(showThinking => ['low', 'medium', 'high'].map(effort => ({ showThinking, effort }))))(
		'aligns collapsed $effort payload with showThinking=$showThinking', async ({ showThinking, effort }) => {
			settings.showThinking = showThinking;
			const h = harness();
			const [info] = await h.discover();
			await h.send(info, effort);
			const body = h.client.post.mock.calls[0][0].body;
			expect(body.model).toBe(`gemini-3.8-flash-${effort}`);
			expect(body.request.generationConfig.thinkingConfig).toEqual(showThinking ? { includeThoughts: true, thinkingLevel: effort } : undefined);
			expect(body.request.generationConfig.maxOutputTokens).toBe(65536);
		},
	);

	it('applies default guidance, supports opt-out on the next request, and logs actual call count', async () => {
		const h = harness(undefined, [{ name: 'read/a', description: 'Read A' }, { name: 'read/b', description: 'Read B' }]);
		const logs = vi.spyOn(log, 'info');
		const [info] = await h.discover();
		h.client.post.mockImplementation(async () => sseResponse({ response: { candidates: [{ content: { parts: [
			{ functionCall: { name: 'read_a', args: { value: 'PRIVATE_A' } } },
			{ functionCall: { name: 'read_b', args: { value: 'PRIVATE_B' } } },
		] } }] } }));
		await h.send(info, 'high');
		const first = h.client.post.mock.calls[0][0].body.request;
		expect(first.systemInstruction.parts).toHaveLength(1);
		expect(h.reports).toHaveLength(2);
		expect(logs.mock.calls.find(([, message]) => message === 'chat request')?.[2]).toMatchObject({ toolGuidance: 'efficient-v1', tools: 2, effort: 'high' });
		expect(logs.mock.calls.find(([, message]) => message === 'chat complete')?.[2]).toMatchObject({ toolCalls: 2 });
		settings.efficientToolUse = false;
		await h.send(info, 'high');
		const second = h.client.post.mock.calls[1][0].body.request;
		expect(second.systemInstruction).toBeUndefined();
		const { systemInstruction: _guidance, labels: _firstLabels, ...firstBody } = first;
		const { labels: _secondLabels, ...secondBody } = second;
		expect(firstBody).toEqual(secondBody);
		expect(logs.mock.calls.filter(([, message]) => message === 'chat request')[1][2]).toMatchObject({ toolGuidance: 'off' });
		expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE_');
	});

	it('shows and removes a new discovered product on refresh without an unavailable placeholder', async () => {
		const h = harness();
		expect((await h.discover()).some(m => m.name === 'Gemini 4 Argon')).toBe(false);
		// Fixture-only gateway ID; no hardcoded Argon entry exists in production.
		const id = 'gemini-argon-test-fixture';
		h.client.postJson.mockResolvedValue({ models: {
			'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)' },
			[id]: { displayName: 'Gemini 4 Argon' },
		} });
		h.provider.refresh();
		const refreshed = await h.discover();
		expect(refreshed.filter(m => m.name === 'Gemini 4 Argon').map(m => m.id)).toEqual([id]);
		h.client.postJson.mockResolvedValue({ models: {
			'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)' },
		} });
		h.provider.refresh();
		expect((await h.discover()).some(m => m.name === 'Gemini 4 Argon')).toBe(false);
	});

	it.each(['low', 'medium', 'high'])('routes discovered Argon %s effort through the Gemini wire with matching limits', async effort => {
		const h = harness();
		h.client.postJson.mockResolvedValue({ models: Object.fromEntries(['high', 'medium', 'low'].map(tier => [
			`gemini-4-argon-${tier}`, { displayName: `Gemini 4 Argon (${tier})` },
		])) });
		const [info] = await h.discover();
		expect(info.name).toBe('Gemini 4 Argon');
		expect(info.configurationSchema?.properties.reasoningEffort).toMatchObject({
			enum: ['low', 'medium', 'high'], default: 'medium',
		});
		expect(info.maxInputTokens).toBe(1_048_576 - 65_536);
		await h.send(info, effort);
		const body = h.client.post.mock.calls[0][0].body;
		expect(body.model).toBe(`gemini-4-argon-${effort}`);
		expect(body.request.generationConfig).toMatchObject({
			maxOutputTokens: 65_536, thinkingConfig: { includeThoughts: true, thinkingLevel: effort },
		});
		expect(body.request.contents[0].role).toBe('user');
		expect(body.request.messages).toBeUndefined();
	});

	it('collapses Hydrogen xhigh into one picker entry and routes Orchestrator (Argon) without duplicate Hydrogen rows', async () => {
		const h = harness();
		h.client.postJson.mockResolvedValue({ models: {
			'gemini-4-hydrogen-high': { displayName: 'Gemini 4 Hydrogen (High)' },
			'gemini-4-hydrogen-xhigh': { displayName: 'Gemini 4 Hydrogen (XHigh)' },
			'gemini-4-hydrogen-medium': { displayName: 'Gemini 4 Hydrogen (Medium)' },
			'gemini-4-hydrogen-low': { displayName: 'Gemini 4 Hydrogen (Low)' },
			'gemini-pro-orchestrator-g1-pro': { displayName: 'Orchestrator (Argon)' },
			'gemini-flash-worker-agy': { displayName: 'Gemini Flash' },
			'gemini-4-carbon-disabled': { displayName: 'Gemini 4 Carbon', disabled: true },
		} });
		const discovered = await h.discover();
		expect(discovered.map(m => m.name)).toEqual(['Gemini 4 Hydrogen', 'Orchestrator (Argon)']);
		const [hydrogen, orchestrator] = discovered;
		expect(hydrogen.configurationSchema?.properties.reasoningEffort?.enum).toEqual(['low', 'medium', 'high', 'xhigh']);
		expect(orchestrator.configurationSchema).toBeUndefined();

		await h.send(hydrogen, 'xhigh');
		expect(h.client.post.mock.calls[0][0].body).toMatchObject({
			model: 'gemini-4-hydrogen-xhigh',
			request: {
				generationConfig: {
					maxOutputTokens: 65_536,
					thinkingConfig: { includeThoughts: true, thinkingLevel: 'xhigh' },
				},
			},
		});

		await h.send(orchestrator, 'high');
		expect(h.client.post.mock.calls[1][0].body).toMatchObject({
			model: 'gemini-pro-orchestrator-g1-pro',
			request: {
				generationConfig: {
					maxOutputTokens: 65_536,
					thinkingConfig: { includeThoughts: true },
				},
			},
		});
	});

	it('filters the observed old Flash IDs from discovery by default, with all as explicit opt-in', async () => {
		const h = harness();
		h.client.postJson.mockResolvedValue({ models: {
			'gemini-3-flash': { displayName: 'Gemini 3 Flash' },
			'gemini-3-flash-agent': { displayName: 'Gemini 3.5 Flash (High)' },
			'gemini-3.5-flash-low': { displayName: 'Gemini 3.5 Flash (Medium)' },
			'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)' },
			'gemini-3.8-flash-medium': { displayName: 'Gemini 3.8 Flash (Medium)' },
			'gemini-3.8-flash-low': { displayName: 'Gemini 3.8 Flash (Low)' },
			'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6 (Thinking)' },
			'claude-opus-4-6-thinking': { displayName: 'Claude Opus 4.6 (Thinking)' },
			'gpt-oss-120b-medium': { displayName: 'GPT-OSS 120B (Medium)' },
			'gemini-argon-test-fixture': { displayName: 'Gemini 4 Argon' },
		} });
		const models = await h.discover();
		expect(models.map(m => m.name)).toEqual([
			'Gemini 3.8 Flash', 'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)',
			'GPT-OSS 120B (Medium)', 'Gemini 4 Argon',
		]);
		expect(models[0].configurationSchema?.properties.reasoningEffort?.enum).toEqual(['low', 'medium', 'high']);
		settings.effortSelection = 'tiers';
		expect((await h.discover()).filter(m => m.family === 'gemini').map(m => m.id)).toEqual([
			'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'gemini-argon-test-fixture',
		]);
		settings.modelSelection = 'all';
		h.provider.refresh();
		expect((await h.discover()).map(m => m.id)).toEqual(expect.arrayContaining(['gemini-3-flash', 'gemini-3-flash-agent', 'gemini-3.5-flash-low']));
		settings.modelSelection = 'latest';
		h.provider.refresh();
		expect((await h.discover()).some(m => m.id === 'gemini-3-flash' || m.id === 'gemini-3-flash-agent')).toBe(false);
	});

	it('uses the actual fallback tier when Medium is unavailable', async () => {
		const h = harness(['high', 'low']);
		const [info] = await h.discover();
		await h.send(info, 'medium');
		const body = h.client.post.mock.calls[0][0].body;
		expect(body.model).toBe('gemini-3.8-flash-high');
		expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
	});

	it('keeps an explicitly selected Low row aligned despite High in options', async () => {
		settings.effortSelection = 'tiers';
		const h = harness();
		const info = (await h.discover()).find(model => model.id.endsWith('-low'))!;
		await h.send(info, 'high');
		const body = h.client.post.mock.calls[0][0].body;
		expect(body.model).toBe('gemini-3.8-flash-low');
		expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
	});

	it('aligns Medium when requested Low is absent from the catalog', async () => {
		const h = harness(['high', 'medium']);
		const [info] = await h.discover();
		await h.send(info, 'low');
		const body = h.client.post.mock.calls[0][0].body;
		expect(body.model).toBe('gemini-3.8-flash-medium');
		expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
	});

	it('keeps the existing off-setting Low fallback consistent', async () => {
		settings.reasoningEffort = 'off';
		const h = harness();
		const [info] = await h.discover();
		await h.send(info, ''); // Invalid/empty picker selection falls back to the setting.
		const body = h.client.post.mock.calls[0][0].body;
		expect(body.model).toBe('gemini-3.8-flash-low');
		expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
	});

	it('preserves Claude numeric budgets and output limits', async () => {
		const h = harness();
		await h.send({ id: 'claude-sonnet-4-6', name: 'Claude', maxOutputTokens: 64000 } as any, 'medium');
		const body = h.client.post.mock.calls[0][0].body;
		expect(body.model).toBe('claude-sonnet-4-6');
		expect(body.request.generationConfig).toMatchObject({ maxOutputTokens: 64000, thinkingConfig: { thinkingBudget: 16384, includeThoughts: true } });
		expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBeUndefined();
	});

	it('skips project resolution and post for an already cancelled token', async () => {
		const h = harness();
		h.token.cancel();
		await h.send();
		expect(h.projects.resolve).not.toHaveBeenCalled();
		expect(h.client.post).not.toHaveBeenCalled();
		expect(h.reports).toEqual([]);
		expect(h.token.listeners.size).toBe(0);
	});

	it.each(['resolve', 'reject'])('settles cancellation before project finishes, including late %s', async completion => {
		const h = harness();
		const project = deferred<string>();
		h.projects.resolve.mockReturnValue(project.promise);
		const run = h.send();
		expect(h.projects.resolve).toHaveBeenCalledOnce();
		h.token.cancel();
		await run; // Must finish while the project promise is still pending.
		expect(h.client.post).not.toHaveBeenCalled();
		if (completion === 'resolve') project.resolve('late-project');
		else project.reject(new Error('late failure'));
		await Promise.resolve();
		expect(h.client.post).not.toHaveBeenCalled();
		expect(h.reports).toEqual([]);
		expect(h.token.listeners.size).toBe(0);
	});

	it('cancels a pending SSE read and emits no finish note or usage after cancel', async () => {
		const h = harness();
		const firstReport = deferred<void>();
		const cancelStream = vi.fn();
		h.client.post.mockResolvedValue(new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"response":{"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"MAX_TOKENS"}],"usageMetadata":{"promptTokenCount":10}}}\n\n'));
			},
			cancel: cancelStream,
		})));
		const infoLog = vi.spyOn(log, 'info');
		const run = h.send(undefined, 'low', part => { h.reports.push(part); firstReport.resolve(); });
		await firstReport.promise;
		h.token.cancel();
		await run;
		expect(cancelStream).toHaveBeenCalledOnce();
		expect(h.reports).toHaveLength(1);
		expect(h.client.post.mock.calls[0][0].signal.aborted).toBe(true);
		expect(infoLog.mock.calls.some(([, message]) => message === 'chat complete')).toBe(false);
		expect(infoLog.mock.calls.find(([, message]) => message === 'chat timing')?.[2]).toMatchObject({ outcome: 'cancelled' });
	});

	it.each([true, false])('records real content milestones without logging content (showThinking=%s)', async showThinking => {
		settings.showThinking = showThinking;
		const h = harness();
		const infoLog = vi.spyOn(log, 'info');
		const debugLog = vi.spyOn(log, 'debug');
		h.client.post.mockResolvedValue(sseResponse({ response: {
			candidates: [{ content: { parts: [
				{ text: 'PRIVATE_THOUGHT', thought: true },
				{ functionCall: { name: 'PRIVATE_TOOL', args: { value: 'PRIVATE_ARG' } } },
				{ text: 'PRIVATE_ANSWER' },
				{ text: 'PRIVATE_ANSWER_2' },
			] } }], usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: 7 },
		} }));
		await h.send();
		const record = infoLog.mock.calls.find(([, message]) => message === 'chat timing')!;
		const timing = record[2]!;
		expect(timing).toMatchObject({ outcome: 'complete' });
		const names = ['providerStart', 'translationDone', 'projectStart', 'projectEnd', 'firstSse', 'firstThought', 'firstTool', 'firstAnswer'];
		let previous = -1;
		for (const name of names) {
			expect(timing[`${name}Ms`]).toBeGreaterThanOrEqual(previous);
			previous = timing[`${name}Ms`] as number;
			expect(debugLog.mock.calls.filter(([, message, data]) => message === 'chat phase' && data?.phase === name)).toHaveLength(1);
		}
		expect(timing.totalMs).toBeGreaterThanOrEqual(previous);
		expect(infoLog.mock.calls.find(([, message]) => message === 'chat complete')?.[2]).toMatchObject({ cachedTokens: 7 });
		for (const calls of [infoLog.mock.calls, debugLog.mock.calls]) expect(JSON.stringify(calls)).not.toContain('PRIVATE_');
	});

	it('reports preparation failures with timing and disposes cancellation listener', async () => {
		const h = harness();
		const infoLog = vi.spyOn(log, 'info');
		h.projects.resolve.mockRejectedValue(new Error('project failed'));
		await expect(h.send()).rejects.toThrow();
		expect(h.token.listeners.size).toBe(0);
		expect(infoLog.mock.calls.find(([, message]) => message === 'chat timing')?.[2]).toMatchObject({ outcome: 'failed' });
		expect(h.client.post).not.toHaveBeenCalled();
	});
});
