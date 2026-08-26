import * as vscode from 'vscode';
import { GatewayClient } from './api/client';
import { toLanguageModelError } from './api/errors';
import {
	Catalog,
	collapseTiers,
	curateModels,
	fetchCatalog,
	ModelSpec,
	resolveTier,
	spec,
} from './api/models';
import {
	buildConfigurationSchema,
	resolveEffort,
	Effort,
	ProviderChatInformation,
} from './api/modelInfo';
import { readSse } from './api/stream';
import { AccountStore } from './auth/store';
import { TokenManager } from './auth/tokens';
import { ProjectResolver } from './auth/project';
import { config } from './config';
import { log, newOperationId } from './log';
import { buildRequest } from './translate/toGemini';
import { emitChunk, finishNote, newEmitState } from './translate/fromGemini';
import { SignatureCache } from './translate/thinking';
import { GenerateContentResponse } from './translate/types';
import { buildAgentMetadata, buildEnvelope, createSession, orderRequestFields } from './api/agent-metadata';
import { QuotaStatusBar } from './ui/statusBar';

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
	private catalog?: { value: Catalog; at: number };
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
	) {
		context.subscriptions.push(this._onDidChange);
		context.subscriptions.push(this.store.onDidChange(() => this.refresh()));
	}

	/** Invalidates discovery and asks VS Code to re-query the model list. */
	refresh(): void {
		this.catalog = undefined;
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<ProviderChatInformation[]> {
		const op = newOperationId();
		const account = await this.store.active();

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
			} catch (error) {
				this.statusBar.setSignedOut();
				if (!(error instanceof vscode.CancellationError)) {
					vscode.window.showErrorMessage(`Antigravity sign-in failed: ${(error as Error).message}`);
				}
				return [];
			}
		}

		try {
			const catalog = await this.loadCatalog(op);
			const signedInAs = (await this.store.active())?.email ?? 'unknown';
			this.statusBar.update(catalog, signedInAs);

			const hidden = new Set(config.hiddenModels());
			this.specs.clear();

			const settingEffort = config.reasoningEffort();
			const defaultEffort: Effort = settingEffort === 'off' ? 'low' : settingEffort;

			let curated = curateModels(catalog.models, config.showAllModels());
			if (config.collapseTiers()) {
				curated = collapseTiers(curated);
			}
			log.info(op, 'catalog curated', { from: catalog.models.length, to: curated.length });

			return curated
				.filter((model) => !hidden.has(model.id))
				.map((model) => {
					this.specs.set(model.id, model);
					return toChatInformation(model, defaultEffort);
				});
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
		const spec = this.specs.get(model.id) ?? fallbackSpec(model);

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
		const wireModel = resolveTier(spec, effort);

		const { request, names } = buildRequest({
			model: spec,
			messages,
			tools: options.tools,
			toolMode: options.toolMode,
			modelOptions,
			reasoningEffort: settingEffort === 'off' ? 'off' : effort,
			includeThoughts: config.showThinking(),
			signatures: this.signatures,
		});

		const project = await this.projects.resolve(op, config.projectId());

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
			thoughtsRequested: config.showThinking(),
			contents: request.contents.length,
			tools: request.tools?.[0]?.functionDeclarations?.length ?? 0,
			toolMode: options.toolMode,
		});

		// Cancellation has to reach the socket, not just stop the loop, or a stopped
		// response keeps burning quota server-side.
		const controller = new AbortController();
		const cancelSub = token.onCancellationRequested(() => controller.abort());

		const state = newEmitState();
		const context = {
			names,
			signatures: this.signatures,
			showThinking: config.showThinking(),
			progress,
		};

		try {
			const response = await this.client.post({
				op,
				action: 'streamGenerateContent',
				body,
				stream: true,
				endpoints: config.generationEndpoints(),
				signal: controller.signal,
			});

			for await (const chunk of readSse<GenerateContentResponse>(response, op)) {
				if (token.isCancellationRequested) {
					break;
				}
				emitChunk(chunk, context, state);
			}

			const note = finishNote(state.finishReason);
			if (note) {
				progress.report(new vscode.LanguageModelTextPart(note));
			}

			log.info(op, 'chat complete', {
				finishReason: state.finishReason,
				promptTokens: state.usage?.promptTokenCount,
				outputTokens: state.usage?.candidatesTokenCount,
				thoughtTokens: state.usage?.thoughtsTokenCount,
			});
		} catch (error) {
			if (token.isCancellationRequested) {
				log.info(op, 'chat cancelled');
				return;
			}
			log.error(op, 'chat failed', { error });
			throw toLanguageModelError(error);
		} finally {
			cancelSub.dispose();
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

	private async loadCatalog(op: string): Promise<Catalog> {
		if (this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) {
			return this.catalog.value;
		}
		const project = await this.projects.resolve(op, config.projectId());
		const value = await fetchCatalog(this.client, op, project);
		this.catalog = { value, at: Date.now() };
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
