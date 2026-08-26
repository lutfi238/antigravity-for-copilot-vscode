import * as vscode from 'vscode';
import { redact } from '../log';

export class GatewayError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
		message: string,
	) {
		super(message);
		this.name = 'GatewayError';
	}

	/** Retryable at the transport level — worth walking to the next endpoint. */
	get isEndpointFailure(): boolean {
		return this.status === 404 || this.status >= 500;
	}

	get isUnauthenticated(): boolean {
		return this.status === 401;
	}

	get isRateLimited(): boolean {
		return this.status === 429;
	}

	/** Seconds to wait, taken from the gateway's `RetryInfo` detail when present. */
	get retryDelaySeconds(): number | undefined {
		const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(this.body);
		return match ? Number(match[1]) : undefined;
	}
}

export async function toGatewayError(response: Response): Promise<GatewayError> {
	const body = redact(await response.text().catch(() => ''));
	return new GatewayError(response.status, body, describe(response.status, body));
}

function describe(status: number, body: string): string {
	const detail = extractMessage(body);
	switch (status) {
		case 400:
			// Almost always a schema or field-shape violation; the gateway names the field.
			return `Antigravity rejected the request: ${detail}`;
		case 401:
			return 'Antigravity credentials are no longer valid. Sign in again.';
		case 403:
			return `Antigravity denied access: ${detail}. If this mentions a project, set a Google Cloud project id in settings.`;
		case 404:
			return `Antigravity endpoint not found: ${detail}`;
		case 429:
			return `Antigravity quota exhausted: ${detail}`;
		default:
			return `Antigravity request failed (${status}): ${detail}`;
	}
}

function extractMessage(body: string): string {
	try {
		const parsed = JSON.parse(body);
		const message = parsed?.error?.message ?? parsed?.[0]?.error?.message;
		if (typeof message === 'string') {
			return message;
		}
	} catch {
		// Not JSON — fall through to the raw body.
	}
	return body.slice(0, 400) || 'no detail';
}

/** Converts a gateway failure into the error shape VS Code renders best in chat. */
export function toLanguageModelError(error: unknown): Error {
	if (error instanceof GatewayError) {
		if (error.isUnauthenticated) {
			return vscode.LanguageModelError.NoPermissions(error.message);
		}
		if (error.status === 403) {
			return vscode.LanguageModelError.NoPermissions(error.message);
		}
		if (error.status === 404) {
			return vscode.LanguageModelError.NotFound(error.message);
		}
		if (error.isRateLimited) {
			const wait = error.retryDelaySeconds;
			return new Error(wait ? `${error.message} Retry in ~${Math.ceil(wait)}s.` : error.message);
		}
		return new Error(error.message);
	}
	return error instanceof Error ? error : new Error(String(error));
}
