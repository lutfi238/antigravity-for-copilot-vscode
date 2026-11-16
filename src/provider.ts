import * as vscode from 'vscode';
import { GatewayClient } from './api/client';
import { GatewayError, toLanguageModelError } from './api/errors';
import {
	Catalog,
	collapseTiers,
	curateModels,
	fetchCatalog,
	ModelSpec,
	resolveTierSpec,
	spec,
} from './api/models';
import {
	buildConfigurationSchema,
	resolveEffort,
	Effort,
	ProviderChatInformation,
} from './api/modelInfo';
import { readSse } from './api/stream';
import { Account, AccountStore } from './auth/store';
import { TokenManager } from './auth/tokens';
import { ProjectResolver } from './auth/project';
import { config } from './config';
import { log, newOperationId } from './log';
import { buildRequest } from './translate/toGemini';
import { closeThinkingPart, createUsageDataPart, emitChunk, finishNote, newEmitState } from './translate/fromGemini';
import { SignatureCache } from './translate/thinking';
import { GenerateContentResponse } from './translate/types';
import { buildAgentMetadata, buildEnvelope, createSession, orderRequestFields } from './api/agent-metadata';
import { QuotaStatusBar } from './ui/statusBar';
import { awaitWithSignal } from './api/cancellation';
import { RequestTiming } from './timing';
import { ImageArtifactReference, ImageArtifactStore, missingImagePreviews } from './imageArtifacts';
import { AccountPlanService } from './api/accountPlan';
import { GeminiQuotaService } from './api/geminiQuota';

/**
 * VS Code passes the model picker's `configurationSchema` selections on fields that
 * `@types/vscode` does not declare. `modelOptions` carries only its own internal keys.
 */
type RuntimeResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

export const VENDOR = 'antigravity';

/** Discovery is not free; reuse it for a short window across picker interactions. */
const CATALOG_TTL_MS = 60_000;

export class AntigravityProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	private readonly signatures = new SignatureCache();
	private readonly specs = new Map<string, ModelSpec>();
	private catalog?: { value: Catalog; at: number; email: string };
	private refreshRevision = 0;
	/** Whether the bar currently holds a rendered, signed-in quota snapshot. */
	private showing = false;
	/** Conversation-scoped telemetry identity, keyed off the open workspace. */
	private readonly session = createSession(
		vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'vscode://antigravity',
	);

	constructor(
		context: vscode.ExtensionContext,
		private readonly store: AccountStore,
		private readonly tokens: TokenManager,
		private readonly client: GatewayClient,
		private readonly projects: ProjectResolver,
		private readonly statusBar: QuotaStatusBar,
		private readonly imageArtifacts?: ImageArtifactStore,
		private readonly plans?: AccountPlanService,
		private readonly geminiQuota?: GeminiQuotaService,
	) {
		context.subscriptions.push(this._onDidChange);
		context.subscriptions.push(this.store.onDidChange(() => this.refresh()));
		context.subscriptions.push({ dispose: () => { this.refreshRevision++; } });
		context.subscriptions.push(
			vscode.window.onDidChangeWindowState((state) => this.onWindowState(state)),
		);
	}

	/**
	 * Nothing polls, so a bar left in the background shows whatever it last fetched.
	 * Refreshing when the window regains focus keeps the number current without spending
	 * quota requests while the user is elsewhere. Only fire once the snapshot is older than
	 * the catalogue TTL: `refresh()` invalidates every cache, so an unguarded focus handler
	 * would re-request discovery, quota, and plan on every alt-tab.
	 */
	private onWindowState(state: vscode.WindowState): void {
		if (!state.focused || !this.showing) return;
		const fetchedAt = this.catalog?.at;
		if (fetchedAt !== undefined && Date.now() - fetchedAt < CATALOG_TTL_MS) return;
		this.refresh();
	}

	/** Invalidates discovery and asks VS Code to re-query the model list. */
	refresh(): void {
		this.refreshRevision++;
		this.catalog = undefined;
		this.plans?.invalidate();
		this.geminiQuota?.invalidate();
		this.statusBar.setLoading?.();
		this.showing = false;
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<ProviderChatInformation[]> {
		const op = newOperationId();
		let account = await this.store.active();

		if (!account) {
			// Silent means "resolve what you can without UI" — offering no models is the
			// correct answer, not a sign-in prompt the user did not ask for.
			if (options.silent) {
				this.statusBar.setSignedOut();
				return [];
			}
			const choice = await vscode.window.showInformationMessage(
				'Sign in to Antigravity to use its models in Copilot Chat.',
				'Sign in',
			);
			if (choice !== 'Sign in') {
				this.statusBar.setSignedOut();
				return [];
			}
			try {
				await this.tokens.addAccount();
				account = await this.store.active();
			} catch (error) {
				this.statusBar.setSignedOut();
				if (!(error instanceof vscode.CancellationError)) {
					vscode.window.showErrorMessage(`Antigravity sign-in failed: ${(error as Error).message}`);
				}
				return [];
			}
		}
		if (!account) { this.statusBar.setSignedOut(); return []; }
		const revision = this.refreshRevision;

		try {
			const catalog = await this.loadCatalog(op, account);
			const active = await this.store.active();
			if (revision !== this.refreshRevision || active?.email !== account.email) return [];

			const hidden = new Set(config.hiddenModels());
			this.specs.clear();

			const settingEffort = config.reasoningEffort();
			const defaultEffort: Effort = settingEffort === 'off' ? 'low' : settingEffort;

			let curated = curateModels(catalog.models, config.showAllModels());
			if (config.collapseTiers()) {
				curated = collapseTiers(curated);
			}
			// Name them, not just count them: "to=8" cannot tell you which model is the
			// one you did not expect.
			log.info(op, 'catalog curated', {
				from: catalog.models.length,
				to: curated.length,
				offered: curated.map((m) => m.id).join(','),
			});

			const offered = curated
				.filter((model) => !hidden.has(model.id))
				.map((model) => {
					this.specs.set(model.id, model);
					return toChatInformation(model, defaultEffort);
				});
			this.statusBar.update(catalog, account.email, {
				plan: this.plans?.peek(account.email), modelCount: offered.length,
				// The discovery response this snapshot was built from. Quota freshness is
				// tracked separately per source; this is the model-catalogue timestamp.
				updatedAt: this.catalog?.at ?? Date.now(),
				geminiQuota: this.geminiQuota?.peek(account.email),
			});
			this.showing = true;
			if (this.plans) {
				const email = account.email;
				void this.plans.get(account).then(plan => {
					if (revision === this.refreshRevision) this.statusBar.setPlan(email, plan);
				});
			}
			if (this.geminiQuota) {
				const email = account.email;
				void this.geminiQuota.get(account).then(quota => {
					if (revision === this.refreshRevision) this.statusBar.setGeminiQuota(email, quota);
				});
			}
			return offered;
		} catch (error) {
			log.error(op, 'discovery failed', { error });
			if (!options.silent) {
				vscode.window.showErrorMessage(`Antigravity: ${(error as Error).message}`);
			}
			return [];
		}
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const op = newOperationId();
		const timing = new RequestTiming(op);
		timing.mark('providerStart');
		const controller = new AbortController();
		const cancelSub = token.onCancellationRequested(() => controller.abort());
		if (token.isCancellationRequested) controller.abort();
		let outcome: 'complete' | 'cancelled' | 'failed' = 'failed';

		try {
			controller.signal.throwIfAborted();
			const spec = this.specs.get(model.id) ?? fallbackSpec(model);
			const showThinking = config.showThinking();

			// The picker selection wins over the setting: `configurationSchema` puts a
			// Thinking Effort control next to the model, and that is the per-request lever.
			const runtime = options as RuntimeResponseOptions;
			const modelOptions = options.modelOptions as Record<string, unknown> | undefined;
			const settingEffort = config.reasoningEffort();
			const fallbackEffort: Effort = settingEffort === 'off' ? 'low' : settingEffort;
			const { effort, source: effortSource } = resolveEffort(
				{
					modelOptions,
					modelConfiguration: runtime.modelConfiguration,
					configuration: runtime.configuration,
				},
				fallbackEffort,
			);

			// A collapsed entry stands in for several tier-specific model ids.
			const resolved = resolveTierSpec(spec, effort);
			const wireModel = resolved.id;

			// Claude needs a non-empty tool_use id once the gateway forwards to Anthropic;
			// Gemini pairs calls to results by name and keeps its known-good shape.
			const toolCallIds = config.toolCallIds();
			const sendToolCallIds =
				toolCallIds === 'all' || (toolCallIds === 'claude' && spec.family === 'claude');

			const { request, names, toolGuidance, attachments } = buildRequest({
				model: resolved,
				messages,
				tools: options.tools,
				toolMode: options.toolMode,
				modelOptions,
				reasoningEffort: settingEffort === 'off' ? 'off' : effort,
				includeThoughts: showThinking,
				efficientToolUse: config.efficientToolUse(),
				sendToolCallIds,
				signatures: this.signatures,
			});

			timing.mark('translationDone');
			timing.mark('projectStart');
			const project = await awaitWithSignal(() => this.projects.resolve(op, config.projectId()), controller.signal);
			controller.signal.throwIfAborted();
			timing.mark('projectEnd');

			// The gateway expects the agent harness envelope: telemetry labels and a
			// session id inside `request`, wrapped in an outer object whose field order
			// matches the real client. Without it we are a different client to them.
			const metadata = buildAgentMetadata(this.session, request, wireModel, Date.now());
			const inner = orderRequestFields({
				...(request as unknown as Record<string, unknown>),
				labels: metadata.labels,
				sessionId: metadata.sessionId,
			});
			const body = buildEnvelope({
				project,
				model: wireModel,
				request: inner,
				requestId: metadata.requestId,
			});

			log.info(op, 'chat request', {
				model: wireModel,
				effort,
				effortFrom: effortSource,
				modelConfigKeys: Object.keys(runtime.modelConfiguration ?? {}).join(',') || 'none',
				thoughtsRequested: showThinking,
				toolCallIdsSetting: toolCallIds,
				sendToolCallIds,
				contents: request.contents.length,
				tools: request.tools?.[0]?.functionDeclarations?.length ?? 0,
				// Proof an image rode along, without inferring it from model behaviour.
				attachments,
				// Name it: the raw enum value (Auto = 1) means nothing when reading a log.
				toolMode: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto',
				toolGuidance,
			});

			const state = newEmitState();
			const context = {
				names,
				signatures: this.signatures,
				showThinking,
				progress,
				onPart: (kind: 'thought' | 'answer' | 'tool') => {
					timing.once(kind === 'thought' ? 'firstThought' : kind === 'answer' ? 'firstAnswer' : 'firstTool');
				},
			};

			controller.signal.throwIfAborted();
			const response = await this.client.post({
				op,
				action: 'streamGenerateContent',
				body,
				stream: true,
				endpoints: config.generationEndpoints(),
				signal: controller.signal,
				timing,
			});

			for await (const chunk of readSse<GenerateContentResponse>(response, op, controller.signal)) {
				controller.signal.throwIfAborted();
				timing.once('firstSse');
				emitChunk(chunk, context, state);
			}
			controller.signal.throwIfAborted();
			// A stream may end immediately after a thought part (for example when the
			// gateway sends usage/finish metadata in a separate final event). Close the
			// native thinking block even when no answer/tool part follows it.
			if (!token.isCancellationRequested) {
				closeThinkingPart(context, state);
			}
			// Tool results and the final answer are separate UI surfaces. Append only
			// our own verified artifacts from this turn when the model omitted them.
			if (state.toolCallIndex === 0 && this.imageArtifacts) {
				const references = currentTurnImageReferences(messages, this.imageArtifacts);
				const previews = missingImagePreviews(references, state.textBuffer);
				if (previews) {
					controller.signal.throwIfAborted();
					timing.once('firstAnswer');
					progress.report(new vscode.LanguageModelTextPart(`\n\n${previews}`));
				}
			}

			const note = finishNote(state.finishReason);
			if (note) {
				progress.report(new vscode.LanguageModelTextPart(note));
			}

			// VS Code's context-window widget learns the actual prompt size from this
			// private usage part. Keep it out of cancelled/partial responses.
			if (!token.isCancellationRequested) {
				const usagePart = createUsageDataPart(state.usage);
				if (usagePart) {
					progress.report(usagePart);
				}
			}

			log.info(op, 'chat complete', {
				finishReason: state.finishReason,
				promptTokens: state.usage?.promptTokenCount,
				outputTokens: state.usage?.candidatesTokenCount,
				thoughtTokens: state.usage?.thoughtsTokenCount,
				cachedTokens: state.usage?.cachedContentTokenCount,
				thoughtParts: state.thoughtParts,
				toolCalls: state.toolCallIndex,
			});
			outcome = 'complete';
		} catch (error) {
			if (controller.signal.aborted || token.isCancellationRequested) {
				outcome = 'cancelled';
				log.info(op, 'chat cancelled');
				return;
			}
			if (error instanceof GatewayError) {
				// The message can be generic; the body is what actually names the field.
				log.error(op, 'chat failed', { status: error.status, body: error.body.slice(0, 1500) });
			} else {
				log.error(op, 'chat failed', { error });
			}
			throw toLanguageModelError(error);
		} finally {
			cancelSub.dispose();
			timing.finish(outcome);
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		// The gateway exposes no token counter, so this is an estimate. VS Code uses it
		// for history trimming, where being slightly conservative is the safe direction.
		const value = typeof text === 'string' ? text : messageText(text);
		return Math.ceil(value.length / 3.5);
	}

	private async loadCatalog(op: string, account: Account): Promise<Catalog> {
		if (this.catalog?.email === account.email && Date.now() - this.catalog.at < CATALOG_TTL_MS) {
			return this.catalog.value;
		}
		const revision = this.refreshRevision;
		const project = await this.projects.resolve(op, config.projectId());
		const value = await fetchCatalog(this.client, op, project, account);
		if (revision === this.refreshRevision) this.catalog = { value, at: Date.now(), email: account.email };
		return value;
	}
}

function toChatInformation(model: ModelSpec, defaultEffort: Effort): ProviderChatInformation {
	const maxInputTokens = model.contextWindow - model.maxOutputTokens;
	const schema = buildConfigurationSchema(model, maxInputTokens, defaultEffort);
	return {
		id: model.id,
		name: model.name,
		family: model.family,
		version: '1.0.0',
		maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		tooltip: `${model.name} via your Google Antigravity account`,
		detail: 'Antigravity',
		capabilities: { toolCalling: true, imageInput: model.supportsImages },
		...(schema ? { configurationSchema: schema } : {}),
	};
}

/** Rebuilds a spec if VS Code asks for a model we did not cache (e.g. after reload). */
function fallbackSpec(model: vscode.LanguageModelChatInformation): ModelSpec {
	return { ...spec(model.id, model.name), maxOutputTokens: model.maxOutputTokens };
}

function messageText(message: vscode.LanguageModelChatRequestMessage): string {
	return message.content
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map((part) => part.value)
		.join('');
}

/** Only tool results after the latest user instruction belong to this generation turn. */
export function currentTurnImageReferences(messages: readonly vscode.LanguageModelChatRequestMessage[], artifacts: ImageArtifactStore): ImageArtifactReference[] {
	const groups: ImageArtifactReference[][] = [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		const references: ImageArtifactReference[] = [];
		for (const part of message.content) {
			if (!(part instanceof vscode.LanguageModelToolResultPart)) continue;
			for (const item of part.content) {
				if (!(item instanceof vscode.LanguageModelTextPart)) continue;
				references.push(...artifacts.findInText(item.value));
			}
		}
		groups.unshift(references);
		if (message.role === vscode.LanguageModelChatMessageRole.User && message.content.some(part => part instanceof vscode.LanguageModelTextPart && part.value.trim().length > 0)) break;
	}
	return [...new Map(groups.flat().map(reference => [reference.uri, reference])).values()];
}
