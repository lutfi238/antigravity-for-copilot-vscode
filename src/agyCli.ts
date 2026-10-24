import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import * as vscode from 'vscode';
import { config } from './config';

const MAX_QUERY_LENGTH = 2_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_RESULT_LENGTH = 40_000;

export const AGY_SEARCH_AGENT_PREFIX = 'antigravity-copilot-search';
/** 1.3.4 made an unresolved --agent a hard error instead of silently using default. */
export const AGY_SEARCH_MIN_VERSION = '1.3.4';

function newSearchAgentName(): string {
	return `${AGY_SEARCH_AGENT_PREFIX}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * A declarative runtime allowlist, not merely an instruction to the model.
 * Requires agy 1.3.4+: older builds may silently fall back to the default agent or
 * ignore excludeDefaultComponents. The init.tools inventory can remain session-wide
 * even for a restricted agent, so transcript and agent-identity validation stay in
 * place as additional boundaries.
 */
export function agySearchAgentDefinition(agentName = AGY_SEARCH_AGENT_PREFIX): string {
	return [
		'---',
		`name: ${agentName}`,
		'description: Isolated native web search without workspace tools.',
		'mainAgent: true',
		'subagent: false',
		'tools:',
		'  - search_web',
		'excludeDefaultComponents: true',
		'inheritCustomizations: false',
		'inheritMcp: false',
		'---',
		'# Web Search',
		'Use only the native search_web tool to answer the requested web query.',
		'',
	].join('\n');
}

export function buildAgySearchArgs(prompt: string, agentName = AGY_SEARCH_AGENT_PREFIX): string[] {
	return [
		'--agent',
		agentName,
		'--print',
		prompt,
		'--output-format',
		'stream-json',
		'--disable-slash-commands',
		'--print-timeout',
		'90s',
	];
}

export interface AgySearchWorkspace {
	readonly cwd: string;
	readonly agentName: string;
	dispose(): Promise<void>;
}

/** Creates an isolated, temporary project so ambient workspace agents/MCP are not loaded. */
export async function createAgySearchWorkspace(agentName = newSearchAgentName()): Promise<AgySearchWorkspace> {
	const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antigravity-copilot-search-'));
	try {
		const agentDirectory = path.join(cwd, '.agents', 'agents', agentName);
		await fs.promises.mkdir(agentDirectory, { recursive: true, mode: 0o700 });
		await fs.promises.writeFile(path.join(agentDirectory, 'agent.md'), agySearchAgentDefinition(agentName), {
			encoding: 'utf8', flag: 'wx', mode: 0o600,
		});
	} catch (error) {
		await fs.promises.rm(cwd, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
	return {
		cwd,
		agentName,
		dispose: () => fs.promises.rm(cwd, { recursive: true, force: true }),
	};
}

export interface AgySearchStreamResult {
	agentName?: string;
	status?: string;
	response?: string;
	error?: string;
	toolError?: string;
	sawSearchWeb: boolean;
	/** Unique search invocation steps, not ACTIVE/COMPLETED updates for one step. */
	searchCallCount: number;
	unexpectedTools: string[];
	malformedEvents: number;
}

/** Builds a prompt that confines the sidecar to the native search tool. */
export function buildAgySearchPrompt(query: string): string {
	return [
		'Use the built-in search_web tool exactly once.',
		`Search query: ${JSON.stringify(query)}`,
		'Do not use any other tool (no file, terminal, browser, MCP, or subagent tools).',
		'Return a concise markdown answer with the most relevant source URLs. Do not invent citations.',
	].join('\n');
}

/** Extracts the final result and verifies that exactly one native search tool ran alone. */
export function parseAgySearchStream(lines: readonly string[]): AgySearchStreamResult {
	let result: AgySearchStreamResult = {
		sawSearchWeb: false, searchCallCount: 0, unexpectedTools: [], malformedEvents: 0,
	};
	const searchInvocations = new Set<string>();

	for (const [eventIndex, line] of lines.entries()) {
		if (!line.trim()) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			result = { ...result, malformedEvents: result.malformedEvents + 1 };
			continue;
		}
		if (!isRecord(event)) {
			result = { ...result, malformedEvents: result.malformedEvents + 1 };
			continue;
		}

		if (event.event === 'init') {
			const init = recordValue(event, 'init');
			const agentName = stringValue(init, 'agent', 'name', 'agent_name', 'agentName');
			if (agentName) result = { ...result, agentName };
		}

		const step = recordValue(event, 'step_update', 'stepUpdate');
		const toolInfo = recordValue(step, 'tool_info', 'toolInfo');
		const rawToolName = stringValue(step, 'tool_name', 'toolName') ??
			stringValue(toolInfo, 'name', 'tool_name', 'toolName');
		const stepType = normalizeToolName(stringValue(step, 'step_type', 'stepType'));
		const toolName = normalizeToolName(rawToolName) ?? (stepType === 'searchweb' ? stepType : undefined);

		if (isToolStep(step, rawToolName, toolInfo, stepType)) {
			if (toolName === 'searchweb') {
				searchInvocations.add(searchInvocationKey(step, toolInfo, eventIndex));
				result = { ...result, sawSearchWeb: true };
				const toolError = extractStepError(step, toolInfo);
				if (toolError) {
					result = { ...result, toolError: toolError.slice(0, 500) };
				}
			} else if (toolName !== 'finish') {
				result = {
					...result,
					unexpectedTools: addUnique(result.unexpectedTools, rawToolName ?? stepType ?? 'unidentified tool'),
				};
			}
		}

		if (event.event === 'result' && isRecord(event.result)) {
			const terminal = event.result;
			result = {
				...result,
				status: typeof terminal.status === 'string' ? terminal.status : undefined,
				response: typeof terminal.response === 'string' ? terminal.response : undefined,
				error: typeof terminal.error === 'string' ? terminal.error : undefined,
			};
		}
	}

	return { ...result, searchCallCount: searchInvocations.size };
}

/** Diagnoses a completed search without accepting extra tools or repeated searches. */
export function searchRunFailure(
	parsed: AgySearchStreamResult,
	exitCode: number | null,
	expectedAgentName?: string,
): string | undefined {
	if (expectedAgentName && parsed.agentName !== expectedAgentName) {
		return 'Antigravity CLI did not start the isolated Web Search agent.';
	}
	if (parsed.agentName === 'default') {
		return 'Antigravity CLI executed the default agent instead of an isolated search.';
	}
	if (parsed.malformedEvents > 0) {
		return 'Antigravity web search stream could not be fully verified.';
	}
	if (parsed.unexpectedTools.length > 0) {
		return 'Antigravity web search attempted an unexpected tool or subagent.';
	}
	if (parsed.searchCallCount !== 1) {
		return parsed.searchCallCount === 0
			? 'Antigravity CLI did not execute its native search_web tool.'
			: 'Antigravity CLI executed search_web more than once; exactly one search is allowed.';
	}
	if (parsed.toolError || parsed.error) return parsed.toolError || parsed.error;
	if (exitCode !== 0 || parsed.status !== 'SUCCESS') {
		return `Antigravity web search failed${exitCode === null ? '' : ` (exit ${exitCode})`}.`;
	}
	if (!parsed.response?.trim()) return 'Antigravity web search returned no answer.';
	return undefined;
}

/** Runs the installed Antigravity CLI and returns its grounded markdown answer. */
export async function runAgySearch(
	query: string,
	token: vscode.CancellationToken,
	createWorkspace: () => Promise<AgySearchWorkspace> = createAgySearchWorkspace,
): Promise<string> {
	const normalized = query.trim();
	if (!normalized) {
		throw new Error('Search query cannot be empty.');
	}
	if (normalized.length > MAX_QUERY_LENGTH) {
		throw new Error(`Search query is too long (maximum ${MAX_QUERY_LENGTH} characters).`);
	}
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}

	const command = resolveAgyCommand();
	await assertAgySearchAgentSupported(command, token);
	const workspace = await createWorkspace();
	try {
		return await runAgySearchProcess(normalized, token, command, workspace);
	} finally {
		// Cleanup failure must not replace a valid search result or its original error.
		await workspace.dispose().catch(() => {});
	}
}

async function runAgySearchProcess(
	normalized: string,
	token: vscode.CancellationToken,
	command: string,
	workspace: AgySearchWorkspace,
): Promise<string> {
	// Cancellation may arrive during version probing or workspace creation.
	if (token.isCancellationRequested) throw new vscode.CancellationError();
	const child = spawn(
		command,
		buildAgySearchArgs(buildAgySearchPrompt(normalized), workspace.agentName),
		{
			cwd: workspace.cwd,
			// Some Unix launchers derive project discovery from PWD instead of getcwd().
			env: { ...process.env, PWD: workspace.cwd, OLDPWD: workspace.cwd },
			shell: false,
			windowsHide: true,
		},
	);

	const lines: string[] = [];
	let outputBytes = 0;
	let outputLimitExceeded = false;
	const stdout = readline.createInterface({ input: child.stdout });
	// Drain diagnostics without exposing them to chat or allowing stderr backpressure
	// to stall the sidecar process.
	child.stderr.resume();
	const cancellation = token.onCancellationRequested(() => {
		child.kill();
	});
	if (token.isCancellationRequested) {
		child.kill();
	}

	try {
		const result = await new Promise<AgySearchStreamResult>((resolve, reject) => {
			let settled = false;
			stdout.on('line', (line) => {
				if (outputLimitExceeded) return;
				outputBytes += Buffer.byteLength(line, 'utf8');
				if (outputBytes > MAX_OUTPUT_BYTES) {
					outputLimitExceeded = true;
					child.kill();
					return;
				}
				lines.push(line);
			});

			child.once('error', (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				if (token.isCancellationRequested) {
					reject(new vscode.CancellationError());
					return;
				}
				if (error.code === 'ENOENT') {
					reject(new Error(`Antigravity CLI was not found at "${command}". Set antigravity.cliPath if needed.`));
					return;
				}
				reject(new Error(`Antigravity web search could not start (${error.code ?? 'process error'}).`));
			});

			child.once('close', (code) => {
				if (settled) return;
				settled = true;
				if (token.isCancellationRequested) {
					reject(new vscode.CancellationError());
					return;
				}
				if (outputLimitExceeded) {
					reject(new Error('Antigravity web search exceeded the output limit; execution could not be verified.'));
					return;
				}
				const parsed = parseAgySearchStream(lines);
				const failure = searchRunFailure(parsed, code, workspace.agentName);
				if (failure) {
					reject(new Error(failure));
					return;
				}
				resolve({ ...parsed, response: parsed.response!.slice(0, MAX_RESULT_LENGTH) });
			});
		});

		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		return result.response ?? '';
	} finally {
		cancellation.dispose();
		stdout.close();
	}
}

/** Older custom agents can ignore isolation fields, so fail before starting a turn. */
export function assertAgySearchAgentSupported(command: string, token: vscode.CancellationToken): Promise<void> {
	if (token.isCancellationRequested) {
		return Promise.reject(new vscode.CancellationError());
	}
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, ['--version'], { env: process.env, shell: false, windowsHide: true });
		let output = '';
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let cancellation: vscode.Disposable | undefined;
		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			cancellation?.dispose();
		};
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) reject(error);
			else resolve();
		};
		const unsupported = () => new Error(`Antigravity Web Search requires agy ${AGY_SEARCH_MIN_VERSION} or newer for isolated tool enforcement.`);
		timeout = setTimeout(() => {
			child.kill();
			finish(new Error('Timed out while checking the agy version.'));
		}, 5_000);
		timeout.unref?.();
		cancellation = token.onCancellationRequested(() => {
			child.kill();
			finish(new vscode.CancellationError());
		});
		if (settled) {
			cancellation.dispose();
			return;
		}
		child.stderr.resume();
		child.stderr.on('data', (chunk: Buffer | string) => {
			output += chunk.toString();
			if (output.length > 4_096) {
				child.kill();
				finish(unsupported());
			}
		});
		child.stdout.on('data', (chunk: Buffer | string) => {
			output += chunk.toString();
			if (output.length > 4_096) {
				child.kill();
				finish(unsupported());
			}
		});
		child.once('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				finish(new Error(`Antigravity CLI was not found at "${command}". Set antigravity.cliPath if needed.`));
			} else {
				finish(new Error(`Antigravity web search could not start (${error.code ?? 'process error'}).`));
			}
		});
		child.once('close', (code) => {
			if (token.isCancellationRequested) {
				finish(new vscode.CancellationError());
				return;
			}
			let match: RegExpExecArray | null = null;
			for (const line of output.split(/\r?\n/)) {
				const candidate = /^(?:agy\s+|v)?(\d+)\.(\d+)\.(\d+)/i.exec(line.trim());
				if (candidate) {
					match = candidate;
					break;
				}
			}
			if (code !== 0 || !match) {
				finish(unsupported());
				return;
			}
			const version = match.slice(1).map(Number);
			const minimum = AGY_SEARCH_MIN_VERSION.split('.').map(Number);
			const supported = version[0] > minimum[0] || version[0] === minimum[0] &&
				(version[1] > minimum[1] || version[1] === minimum[1] && version[2] >= minimum[2]);
			finish(supported ? undefined : unsupported());
		});
		if (token.isCancellationRequested) {
			child.kill();
			finish(new vscode.CancellationError());
		}
	});
}

function resolveAgyCommand(): string {
	const configured = config.cliPath().trim();
	if (configured && configured !== 'agy') {
		return configured;
	}

	const environment = process.env.AGY_PATH?.trim();
	if (environment) {
		return environment;
	}

	if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
		const installed = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.EXE');
		if (fs.existsSync(installed)) {
			return installed;
		}
	}
	return configured || 'agy';
}

function isToolStep(
	step: Record<string, unknown> | undefined,
	rawToolName: string | undefined,
	toolInfo: Record<string, unknown> | undefined,
	stepType: string | undefined,
): boolean {
	return step !== undefined && (rawToolName !== undefined || toolInfo !== undefined ||
		stepType === 'tool' || stepType === 'toolcall' || stepType === 'subagent' || stepType === 'searchweb');
}

/** Status updates for one indexed invocation must not look like multiple searches. */
function searchInvocationKey(
	step: Record<string, unknown> | undefined,
	toolInfo: Record<string, unknown> | undefined,
	eventIndex: number,
): string {
	const id = step?.step_index ?? step?.stepIndex ?? toolInfo?.call_id ?? toolInfo?.callId ?? toolInfo?.id;
	// Without an invocation id, fail closed on repeated search events rather than
	// silently treating potentially separate calls as one.
	return id === undefined ? `event:${eventIndex}` : `step:${String(id)}`;
}

function recordValue(value: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
	if (!value) return undefined;
	for (const key of keys) {
		if (isRecord(value[key])) return value[key];
	}
	return undefined;
}

function stringValue(value: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
	if (!value) return undefined;
	for (const key of keys) {
		if (typeof value[key] === 'string') return value[key];
	}
	return undefined;
}

function normalizeToolName(value: string | undefined): string | undefined {
	return value?.replace(/[_-]/g, '').toLowerCase();
}

function addUnique(values: readonly string[], value: string): string[] {
	return values.includes(value) ? [...values] : [...values, value];
}

function extractStepError(
	step: Record<string, unknown> | undefined,
	toolInfo: Record<string, unknown> | undefined,
): string | undefined {
	const direct = errorMessage(step?.error);
	if (direct) return direct;
	const infoError = errorMessage(toolInfo?.error);
	if (infoError) return infoError;
	for (const key of ['error_message', 'errorMessage']) {
		if (step && typeof step[key] === 'string' && (step[key] as string).trim()) return (step[key] as string).trim();
		if (toolInfo && typeof toolInfo[key] === 'string' && (toolInfo[key] as string).trim()) return (toolInfo[key] as string).trim();
	}
	return undefined;
}

function errorMessage(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (isRecord(value)) {
		for (const key of ['message', 'error_message', 'errorMessage']) {
			if (typeof value[key] === 'string' && (value[key] as string).trim()) return (value[key] as string).trim();
		}
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
