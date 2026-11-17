import * as vscode from 'vscode';
import { GatewayClient } from './api/client';
import { GatewayError } from './api/errors';
import { AgentSession, buildAgentMetadata, buildEnvelope, createSession, orderRequestFields } from './api/agent-metadata';
import { readSse } from './api/stream';
import { awaitWithSignal } from './api/cancellation';
import { AccountStore } from './auth/store';
import { ProjectResolver } from './auth/project';
import { config } from './config';
import { log, newOperationId } from './log';
import { GeminiRequest, GenerateContentResponse } from './translate/types';
import { ThinkingTier } from './api/models';

/**
 * Development-only contract probe.
 *
 * Answers one question the picker cannot: which effort tiers a discovered model id
 * actually accepts. Nothing in discovery publishes a tier list, and guessing an id risks
 * a 404 that looks like a broken build. The probe sends a one-token prompt to an explicit
 * list of candidate ids and records the status each one returns.
 *
 * Only registered in the Extension Development Host. A packaged build never reaches this
 * code, so it adds no command surface to a release.
 */

/** Cheap enough to run against several candidates without spending real quota. */
const PROBE_PROMPT = 'Reply with the single word: ok';

const PROBE_MAX_OUTPUT_TOKENS = 32;

/**
 * Hard cap on requests per run.
 *
 * Every case is a real generation against a metered account. A pasted route list has no
 * natural bound, so the cap is enforced before anything is sent rather than trusted to
 * the input box.
 */
export const MAX_CASES = 12;

/**
 * Per-case deadline, including project resolution.
 *
 * Without it a hung endpoint holds the run open until VS Code is reloaded, because
 * `Cancel` only aborts what the signal already reached.
 */
const CASE_TIMEOUT_MS = 45_000;

interface ProbeOutcome {
	model: string;
	/** The `thinkingLevel` under test, or undefined for a route-only probe. */
	level?: string;
	status: 'accepted' | 'inconclusive' | `rejected ${number}` | 'error';
	detail?: string;
}

/**
 * Builds the probe request for one case.
 *
 * Two independent questions get probed, because they fail differently:
 *  - route acceptance: does this model id exist at all (404 vs 200)?
 *  - effort acceptance: does the same id accept a `thinkingConfig.thinkingLevel`?
 *
 * `includeThoughts` is present on every case, including the baseline, so `thinkingLevel`
 * is the only field that varies. A baseline that also dropped `thinkingConfig` would
 * change two fields at once and make any difference between them unattributable. It is
 * also what makes `thoughtsTokenCount` observable at all.
 *
 * Exported because this is the contract the probe's conclusions rest on.
 */
export function buildProbeRequest(level: string | undefined): GeminiRequest {
	return {
		contents: [{ role: 'user', parts: [{ text: PROBE_PROMPT }] }],
		generationConfig: {
			maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
			thinkingConfig: {
				includeThoughts: true,
				...(level !== undefined ? { thinkingLevel: level as ThinkingTier } : {}),
			},
		},
	};
}

/** Sends one probe case and classifies what came back. */
async function probeModel(
	client: GatewayClient,
	projects: ProjectResolver,
	session: AgentSession,
	op: string,
	model: string,
	level: string | undefined,
	signal: AbortSignal,
): Promise<ProbeOutcome> {
	const request = buildProbeRequest(level);
	try {
		// `resolve()` issues its own discovery requests, so it must honour the signal too:
		// otherwise Cancel cannot interrupt the probe until the first generation request.
		// It is also cached on the account, so resolving once per run is enough.
		const project = await awaitWithSignal(() => projects.resolve(op, config.projectId()), signal);
		const metadata = buildAgentMetadata(session, request, model, Date.now());
		const inner = orderRequestFields({
			...(request as unknown as Record<string, unknown>),
			labels: metadata.labels,
			sessionId: metadata.sessionId,
		});
		const body = buildEnvelope({ project, model, request: inner, requestId: metadata.requestId });

		const response = await client.post({
			op,
			action: 'streamGenerateContent',
			body,
			stream: true,
			endpoints: config.generationEndpoints(),
			signal,
		});

		// Drain the stream: the gateway can accept the connection and only then reject the
		// model, so returning at the headers would report a false success.
		const evidence = new StreamEvidence();
		for await (const chunk of readSse<GenerateContentResponse>(response, op, signal)) {
			evidence.observe(chunk);
		}
		return { model, level, ...evidence.classify() };
	} catch (error) {
		if (error instanceof GatewayError) {
			return { model, level, status: `rejected ${error.status}`, detail: error.message };
		}
		return { model, level, status: 'error', detail: (error as Error).message };
	}
}

/**
 * Classifies what a drained generation stream actually proved.
 *
 * `readSse` only parses JSON: it drops `[DONE]`, skips malformed events, and never raises
 * an `error` object embedded in a `data:` frame. Treating a clean EOF as success therefore
 * reports a rejected model as accepted. This requires positive evidence instead — a
 * candidate, answer text, or usage — and surfaces an embedded error when one arrived.
 */
export class StreamEvidence {
	private candidates = 0;
	private textParts = 0;
	private usage?: string;
	private thoughts?: number;
	private finish?: string;
	private error?: string;

	observe(chunk: GenerateContentResponse): void {
		// The gateway nests the payload under `response`; plain `candidates` also appears.
		const payload = chunk.response ?? chunk;
		const embedded = payload.error;
		if (embedded) {
			this.error = describeEmbeddedError(embedded);
			return;
		}
		this.candidates += payload.candidates?.length ?? 0;
		for (const candidate of payload.candidates ?? []) {
			for (const part of candidate.content?.parts ?? []) {
				if (typeof part.text === 'string' && part.text.length > 0) {
					this.textParts++;
				}
			}
			if (candidate.finishReason) {
				this.finish = candidate.finishReason;
			}
		}
		const meta = payload.usageMetadata;
		if (meta) {
			this.usage = `prompt=${meta.promptTokenCount ?? '?'} output=${meta.candidatesTokenCount ?? '?'}`;
			// Thought tokens are the only per-request signal that reasoning depth changed.
			// A single sample cannot prove control, but a flat count across every level
			// argues the gateway ignored the setting.
			if (typeof meta.thoughtsTokenCount === 'number') {
				this.thoughts = meta.thoughtsTokenCount;
			}
		}
	}

	classify(): Pick<ProbeOutcome, 'status' | 'detail'> {
		if (this.error) {
			return { status: 'error', detail: this.error };
		}
		const detail = [
			this.candidates ? `candidates=${this.candidates}` : undefined,
			this.textParts ? `textParts=${this.textParts}` : undefined,
			this.thoughts !== undefined ? `thoughts=${this.thoughts}` : undefined,
			this.finish ? `finish=${this.finish}` : undefined,
			this.usage,
		]
			.filter(Boolean)
			.join(' ');
		// No candidate, no text, no usage: the stream ended without proving the model ran.
		// A rejected id, an empty `[DONE]`-only stream, and a silently dropped malformed
		// event all land here, so the only honest label is inconclusive.
		if (!detail) {
			return { status: 'inconclusive', detail: 'stream ended with no generation evidence' };
		}
		// `accepted` means the gateway served the request. It does NOT mean it honored the
		// thinking level: an unknown level can be silently ignored, so this label alone
		// never establishes a picker capability.
		return { status: 'accepted', detail };
	}
}

function describeEmbeddedError(error: unknown): string {
	if (typeof error === 'string') {
		return error;
	}
	if (typeof error !== 'object' || error === null) {
		return String(error);
	}
	const message = 'message' in error && typeof error.message === 'string' ? error.message : JSON.stringify(error);
	const status = 'status' in error ? error.status : 'code' in error ? error.code : undefined;
	return status === undefined ? message : `${String(status)}: ${message}`;
}

/**
 * Splits a user-supplied list on commas/whitespace so a whole candidate family can be
 * pasted at once.
 */
function parseCandidates(input: string | undefined, fallback: string[]): string[] {
	const fromInput = (input ?? '')
		.split(/[\s,]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	return fromInput.length > 0 ? [...new Set(fromInput)] : fallback;
}

/** Candidate ids for a base model: the base itself plus every tier suffix we know. */
function tierCandidates(base: string): string[] {
	return [
		base,
		`${base}-low`,
		`${base}-medium`,
		`${base}-high`,
		`${base}-xhigh`,
		`${base}-extra-high`,
		`${base}-minimal`,
	];
}

/**
 * Effort levels worth testing against a single id.
 *
 * `none` is a deliberate baseline: without it there is nothing to compare a level
 * against, so "accepted" would say nothing about whether the level changed anything.
 * `bogus-level` is a negative control: if the gateway accepts it too, then acceptance
 * proves nothing about effort support and every `accepted` row must be read that way.
 */
const PROBE_LEVELS: Array<string | undefined> = [undefined, 'low', 'medium', 'high', 'xhigh', 'bogus-level'];

/**
 * Runs one case under its own deadline, linked to the caller's signal.
 *
 * The timer is always cleared and the linked listener always detached, so neither a
 * finished case nor an aborted run leaves a timer or listener behind. A separate
 * controller is used instead of `AbortSignal.any` because the deadline has to produce a
 * distinguishable outcome from a user cancellation.
 */
async function probeWithDeadline(
	client: GatewayClient,
	projects: ProjectResolver,
	session: AgentSession,
	op: string,
	unit: { model: string; level?: string },
	parent: AbortSignal,
): Promise<ProbeOutcome> {
	const controller = new AbortController();
	const abort = () => controller.abort(parent.reason);
	if (parent.aborted) {
		abort();
	} else {
		parent.addEventListener('abort', abort, { once: true });
	}
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, CASE_TIMEOUT_MS);
	try {
		return await probeModel(client, projects, session, op, unit.model, unit.level, controller.signal);
	} finally {
		clearTimeout(timer);
		parent.removeEventListener('abort', abort);
		if (timedOut) {
			log.warn(op, 'dev probe timed out', { model: unit.model, timeoutMs: CASE_TIMEOUT_MS });
		}
	}
}

/** Names the traffic the user is about to authorize, including any truncation. */
export function buildConsentDetail(work: Array<{ model: string; level?: string }>, requested: number): string {
	const lines = work.map((unit, index) => {
		const target = unit.level ? `${unit.model} @ thinkingLevel=${unit.level}` : `${unit.model} (no thinkingLevel)`;
		return `${index + 1}. ${target}`;
	});
	const notes = [
		`${work.length} generation request(s), each capped at ${PROBE_MAX_OUTPUT_TOKENS} output tokens.`,
		`Per-case timeout: ${CASE_TIMEOUT_MS / 1000}s. Cancel stops the run.`,
	];
	if (requested > work.length) {
		notes.push(`${requested - work.length} extra case(s) were dropped by the ${MAX_CASES}-case limit.`);
	}
	notes.push('This spends real quota. Results are logged and copied to the clipboard.');
	return [...notes, '', ...lines].join('\n');
}

export function registerDevProbe(context: vscode.ExtensionContext, client: GatewayClient, projects: ProjectResolver): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity.dev.probeEfforts', async () => {
			const store = new AccountStore(context);
			const account = await store.active();
			if (!account) {
				void vscode.window.showWarningMessage('Sign in to Antigravity before probing effort tiers.');
				return;
			}

			const mode = await vscode.window.showQuickPick(
				[
					{
						label: 'Effort levels on one id',
						description: 'Same model id, each thinkingLevel in turn',
						detail: 'Answers "which efforts does this id accept?" — the Sonar question.',
						mode: 'levels' as const,
					},
					{
						label: 'Route ids for one base',
						description: 'Base id plus -low/-medium/-high/-xhigh suffixes',
						detail: 'Answers "which tier ids exist?" — no thinkingLevel sent.',
						mode: 'routes' as const,
					},
				],
				{ title: 'Probe effort support', placeHolder: 'What should be tested?' },
			);
			if (!mode) {
				return;
			}

			const input = await vscode.window.showInputBox({
				title: mode.label,
				prompt: mode.mode === 'levels'
					? 'Model id to test every thinkingLevel against'
					: 'Base model id, or a comma-separated list of full ids',
				value: mode.mode === 'levels' ? 'gemini-4-hydrogen-sonar' : 'gemini-4-hydrogen-sonar',
			});
			if (input === undefined) {
				return;
			}

			// One unit of work is an (id, level) pair. Levels mode holds the id fixed and
			// varies the level; routes mode varies the id and sends no level at all.
			const requested: Array<{ model: string; level?: string }> =
				mode.mode === 'levels'
					? PROBE_LEVELS.map((level) => ({ model: input.trim(), level }))
					: parseCandidates(input, []).length > 1
						? parseCandidates(input, []).map((model) => ({ model }))
						: tierCandidates(input.trim()).map((model) => ({ model }));

			// The cap is applied to what was asked for, not trusted to the input box: a
			// pasted list has no natural bound and every case is a metered generation.
			const work = requested.slice(0, MAX_CASES);
			if (work.length === 0) {
				void vscode.window.showWarningMessage('Nothing to probe: the model list was empty.');
				return;
			}

			// Disclose the traffic before it happens. The probe talks to a metered backend,
			// and "it looked cheap" is not consent.
			const confirm = await vscode.window.showWarningMessage(
				`Probe ${work.length} case(s) against your Antigravity account?`,
				{ modal: true, detail: buildConsentDetail(work, requested.length) },
				'Probe',
			);
			if (confirm !== 'Probe') {
				return;
			}

			const session = createSession(vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'vscode://antigravity');
			const controller = new AbortController();
			const outcomes: ProbeOutcome[] = [];

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Probing effort support', cancellable: true },
				async (progress, token) => {
					// One listener for the whole run; it is disposed in the `finally` below so
					// a finished run leaves nothing attached to a disposable VS Code token.
					const cancel = token.onCancellationRequested(() => controller.abort());
					try {
						for (const [index, unit] of work.entries()) {
							if (controller.signal.aborted) {
								break;
							}
							progress.report({
								message: `${unit.model}${unit.level ? ` @ ${unit.level}` : ''}`,
								increment: 100 / work.length,
							});
							const op = newOperationId();
							log.info(op, 'dev probe', {
								model: unit.model,
								level: unit.level ?? 'none',
								index: index + 1,
								total: work.length,
							});
							const outcome = await probeWithDeadline(
								client, projects, session, op, unit, controller.signal,
							);
							log.info(op, 'dev probe result', {
								model: outcome.model,
								level: outcome.level ?? 'none',
								status: outcome.status,
								detail: outcome.detail,
							});
							outcomes.push(outcome);
						}
					} finally {
						cancel.dispose();
					}
				},
			);

			const summary = outcomes
				.map((outcome) => {
					const label = outcome.level
						? `${outcome.model} @ ${outcome.level}${outcome.level === 'bogus-level' ? ' (negative control)' : ''}`
						: `${outcome.model} (baseline, no thinkingLevel)`;
					return `${label} → ${outcome.status}${outcome.detail ? ` (${outcome.detail})` : ''}`;
				})
				.join('\n');
			const levels = outcomes.filter((outcome) => outcome.level !== undefined && outcome.level !== 'bogus-level');
			const control = outcomes.find((outcome) => outcome.level === 'bogus-level');
			const accepted = levels.filter((outcome) => outcome.status === 'accepted').length;
			// Say plainly what this run does and does not establish, so a reader cannot
			// mistake "the gateway served it" for "the picker can offer it". Each claim is
			// limited to what the wire actually shows.
			const caveat = [
				'',
				`${accepted}/${levels.length} named-level probes were served.`,
				'',
				'This is request-acceptance evidence only. It is NOT a capability result:',
				'- Served means the gateway accepted the body. An unknown level may be ignored.',
				control
					? `- Negative control (bogus-level): ${control.status}. ${
						control.status === 'accepted'
							? 'It was served too, so level acceptance carries no information.'
							: 'It was refused, but a generic enum check also refuses invalid values; that alone does not prove valid levels are honored.'
					}`
					: '- Negative control was not run; level acceptance cannot be interpreted.',
				'- Identical thoughts= counts across levels are inconclusive, not proof: a one-word',
				'  answer under a 32-token cap can saturate with minimal reasoning either way.',
				'- A 400 needs its reason read before any conclusion: it can be a level rejection,',
				'  a thinkingConfig shape error, or an output/thinking limit, not "no effort".',
				'',
				'Stronger evidence needs a wire capture or repeated samples with a task that',
				'forces sustained reasoning. Do not change the picker from this run alone.',
			].join('\n');
			log.info('dev-probe', 'probe summary', { results: outcomes.length, mode: mode.mode });
			// Copyable, because the useful next step is pasting this back for a fix.
			await vscode.env.clipboard.writeText(`${summary}\n${caveat}`);
			void vscode.window.showInformationMessage(
				`Probe finished for ${outcomes.length} case(s). Results copied to the clipboard and written to Output → Antigravity.`,
			);
		}),
	);
}
