import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLogging(context: vscode.ExtensionContext): vscode.LogOutputChannel {
	channel = vscode.window.createOutputChannel('Antigravity', { log: true });
	context.subscriptions.push(channel);
	return channel;
}

export function showLogs(): void {
	channel?.show();
}

/**
 * Correlates every log line belonging to one logical operation (a chat request,
 * an auth flow, a discovery call) so retries and fallbacks can be traced.
 */
export function newOperationId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Prompts, reasoning, tool arguments, tool results and credentials never reach the
 * log. Only counts, sizes, hashes, transport decisions and redacted errors do.
 */
export const log = {
	trace(op: string, message: string, data?: Record<string, unknown>): void {
		channel?.trace(format(op, message, data));
	},
	debug(op: string, message: string, data?: Record<string, unknown>): void {
		channel?.debug(format(op, message, data));
	},
	info(op: string, message: string, data?: Record<string, unknown>): void {
		channel?.info(format(op, message, data));
	},
	warn(op: string, message: string, data?: Record<string, unknown>): void {
		channel?.warn(format(op, message, data));
	},
	error(op: string, message: string, data?: Record<string, unknown>): void {
		channel?.error(format(op, message, data));
	},
};

function format(op: string, message: string, data?: Record<string, unknown>): string {
	const prefix = `[${op}] ${message}`;
	if (!data || Object.keys(data).length === 0) {
		return prefix;
	}
	const pairs = Object.entries(data).map(([k, v]) => `${k}=${scrub(v)}`);
	return `${prefix} ${pairs.join(' ')}`;
}

function scrub(value: unknown): string {
	if (value === undefined) {
		return 'undefined';
	}
	if (value === null) {
		return 'null';
	}
	if (typeof value === 'string') {
		return value.length > 200 ? `<${value.length} chars>` : value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value instanceof Error) {
		return value.message;
	}
	return '<object>';
}

/** Strips credential-shaped values before an error string reaches the log. */
export function redact(text: string): string {
	return text
		.replace(/ya29\.[\w.\-]+/g, '<access-token>')
		.replace(/1\/\/[\w.\-]+/g, '<refresh-token>')
		.replace(/GOCSPX-[\w\-]+/g, '<client-secret>');
}
