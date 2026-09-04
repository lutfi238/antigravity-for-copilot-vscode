import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as vscode from 'vscode';
import { config } from './config';

const MAX_QUERY_LENGTH = 2_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_RESULT_LENGTH = 40_000;

export interface AgySearchStreamResult {
	status?: string;
	response?: string;
	error?: string;
	toolError?: string;
	sawSearchWeb: boolean;
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

/** Extracts the final result and verifies that the native search tool ran. */
export function parseAgySearchStream(lines: readonly string[]): AgySearchStreamResult {
	let result: AgySearchStreamResult = { sawSearchWeb: false };

	for (const line of lines) {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event)) {
			continue;
		}

		const step = isRecord(event.step_update) ? event.step_update : undefined;
		const toolName = step && typeof step.tool_name === 'string' ? step.tool_name : undefined;
		const toolInfo = step && isRecord(step.tool_info) ? step.tool_info : undefined;
		if (toolName === 'search_web' || toolInfo?.name === 'search_web') {
			result = { ...result, sawSearchWeb: true };
			const toolError = isRecord(toolInfo?.error) ? toolInfo.error.message : undefined;
			if (typeof toolError === 'string' && toolError.trim()) {
				result = { ...result, toolError: toolError.slice(0, 500) };
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

	return result;
}

/** Runs the installed Antigravity CLI and returns its grounded markdown answer. */
export async function runAgySearch(query: string, token: vscode.CancellationToken): Promise<string> {
	const normalized = query.trim();
	if (!normalized) {
		throw new Error('Search query cannot be empty.');
	}
	if (normalized.length > MAX_QUERY_LENGTH) {
		throw new Error(`Search query is too long (maximum ${MAX_QUERY_LENGTH} characters).`);
	}

	const command = resolveAgyCommand();
	const child = spawn(
		command,
		[
			'--print',
			buildAgySearchPrompt(normalized),
			'--output-format',
			'stream-json',
			'--disable-slash-commands',
			'--print-timeout',
			'90s',
		],
		{
			cwd: workspaceCwd(),
			env: process.env,
			windowsHide: true,
		},
	);

	const lines: string[] = [];
	let outputBytes = 0;
	const stdout = readline.createInterface({ input: child.stdout });
	// Drain diagnostics without exposing them to chat or allowing stderr backpressure
	// to stall the sidecar process.
	child.stderr.resume();
	const cancellation = token.onCancellationRequested(() => {
		child.kill();
	});

	try {
		const result = await new Promise<AgySearchStreamResult>((resolve, reject) => {
			let settled = false;
			stdout.on('line', (line) => {
				outputBytes += Buffer.byteLength(line, 'utf8');
				if (outputBytes <= MAX_OUTPUT_BYTES) {
					lines.push(line);
				}
			});

			child.once('error', (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				if (error.code === 'ENOENT') {
					reject(new Error(`Antigravity CLI was not found at "${command}". Set antigravity.cliPath if needed.`));
					return;
				}
				reject(new Error(`Antigravity web search could not start (${error.code ?? 'process error'}).`));
			});

			child.once('close', (code) => {
				if (settled) return;
				settled = true;
				const parsed = parseAgySearchStream(lines);
				if (parsed.status === 'SUCCESS' && parsed.sawSearchWeb && !parsed.toolError && parsed.response?.trim()) {
					resolve({ ...parsed, response: parsed.response.slice(0, MAX_RESULT_LENGTH) });
					return;
				}
				if (!parsed.sawSearchWeb) {
					reject(new Error('Antigravity CLI did not execute its native search_web tool.'));
					return;
				}
				reject(new Error(parsed.toolError || parsed.error || `Antigravity web search failed${code === null ? '' : ` (exit ${code})`}.`));
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

function workspaceCwd(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder?.uri.scheme === 'file' && folder.uri.fsPath) {
		return folder.uri.fsPath;
	}
	return process.cwd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
