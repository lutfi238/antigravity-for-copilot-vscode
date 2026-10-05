import { DISCOVERY_ENDPOINTS, GENERATION_ENDPOINTS, userAgent } from './constants';
import { GatewayError, toGatewayError } from './errors';
import { httpFetch } from './http';
import { TokenManager } from '../auth/tokens';
import { log } from '../log';

export type EndpointSet = readonly string[];

// Partial views of the Gemini-dialect body; only the fields the summary reads.
interface SummaryPart {
	text?: unknown;
	thought?: unknown;
	inlineData?: unknown;
	functionCall?: { id?: unknown };
	functionResponse?: { id?: unknown };
}

interface SummaryContent {
	role?: unknown;
	parts?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function contentsOf(body: unknown): SummaryContent[] {
	const request = isRecord(body) ? body.request : undefined;
	const contents = isRecord(request) ? request.contents : undefined;
	return Array.isArray(contents) ? contents.filter(isRecord) : [];
}

function partsOf(content: SummaryContent): SummaryPart[] {
	return Array.isArray(content.parts) ? content.parts.filter(isRecord) : [];
}

// The gateway rejects an empty `tool_use.id`, so only a non-empty string counts as forwarded.
function hasId(call: { id?: unknown }): boolean {
	return typeof call.id === 'string' && call.id.length > 0;
}

// The newest blocks are the ones that explain a rejection; older ones only bloat the log.
const MAX_BLOCK_ENTRIES = 12;

/**
 * Structural summary of an outgoing request for the debug log.
 *
 * Reads only shapes and counts — never prompt text, tool names, arguments or results —
 * so it can confirm whether tool-call ids are being forwarded without exposing
 * conversation content. Counters cover every block; per-block entries cover only the
 * last `MAX_BLOCK_ENTRIES`, keyed by their real index.
 */
export function summarizeRequest(body: unknown): Record<string, string> | undefined {
	const contents = contentsOf(body);
	if (contents.length === 0) {
		return undefined;
	}

	const summary: Record<string, string> = { blocks: String(contents.length) };
	const firstListed = Math.max(0, contents.length - MAX_BLOCK_ENTRIES);
	let calls = 0;
	let callIds = 0;
	let responses = 0;
	let responseIds = 0;

	contents.forEach((block, index) => {
		const kinds: string[] = [];

		for (const part of partsOf(block)) {
			if (part.functionCall) {
				kinds.push('call');
				calls++;
				if (hasId(part.functionCall)) {
					callIds++;
				}
			} else if (part.functionResponse) {
				kinds.push('result');
				responses++;
				if (hasId(part.functionResponse)) {
					responseIds++;
				}
			} else if (part.inlineData) {
				kinds.push('image');
			} else if (typeof part.text === 'string') {
				kinds.push(part.thought ? 'thought' : 'text');
			}
		}

		if (index >= firstListed) {
			const role = typeof block.role === 'string' ? block.role : '?';
			summary[`b${index}`] = `${role}:${kinds.join('+') || 'empty'}`;
		}
	});

	summary.calls = String(calls);
	summary.callIds = String(callIds);
	summary.responses = String(responses);
	summary.responseIds = String(responseIds);
	return summary;
}

export interface RequestOptions {
	op: string;
	action: string;
	body: unknown;
	endpoints?: EndpointSet;
	signal?: AbortSignal;
	/** Set for `streamGenerateContent`; adds `?alt=sse` and the SSE Accept header. */
	stream?: boolean;
}

/**
 * Transport for the `v1internal` gateway.
 *
 * Two behaviours matter here: it walks the endpoint fallback chain when a host is
 * unavailable, and it retries exactly once on 401 after forcing a token refresh
 * (an access token can expire between the skew check and the request landing).
 */
export class GatewayClient {
	constructor(private readonly tokens: TokenManager) {}

	async postJson<T>(options: RequestOptions): Promise<T> {
		const response = await this.post(options);
		return (await response.json()) as T;
	}

	/** Returns the raw response so the caller can read the SSE body incrementally. */
	async post(options: RequestOptions): Promise<Response> {
		const endpoints = options.endpoints ?? (options.stream ? GENERATION_ENDPOINTS : DISCOVERY_ENDPOINTS);
		let lastError: GatewayError | undefined;

		for (const endpoint of endpoints) {
			try {
				return await this.attempt(endpoint, options, false);
			} catch (error) {
				if (!(error instanceof GatewayError)) {
					throw error;
				}
				if (error.isUnauthenticated) {
					// Force a refresh and retry this same endpoint once.
					log.warn(options.op, 'unauthenticated, refreshing and retrying');
					return await this.attempt(endpoint, options, true);
				}
				if (!error.isEndpointFailure) {
					throw error;
				}
				log.warn(options.op, 'endpoint failed, trying next', { endpoint, status: error.status });
				lastError = error;
			}
		}

		throw lastError ?? new Error('No Antigravity endpoint accepted the request.');
	}

	private async attempt(endpoint: string, options: RequestOptions, forceRefresh: boolean): Promise<Response> {
		if (forceRefresh) {
			await this.tokens.invalidateActive();
		}
		const accessToken = await this.tokens.accessToken();

		const query = options.stream ? '?alt=sse' : '';
		const url = `${endpoint}/v1internal:${options.action}${query}`;

		// Exactly the header set the Antigravity CLI sends. Notably absent: `Accept`
		// (the response format is chosen by `?alt=sse`), `X-Goog-Api-Client` and
		// `Client-Metadata`. Sending extras makes us look like a different client.
		const headers: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			'Accept-Encoding': 'gzip',
			'User-Agent': userAgent(),
		};

		const payload = JSON.stringify(options.body);
		log.debug(options.op, 'request', { action: options.action, endpoint, bytes: payload.length });
		const shape = summarizeRequest(options.body);
		if (shape) {
			log.debug(options.op, 'request shape', shape);
		}

		const response = await httpFetch(url, {
			method: 'POST',
			headers,
			body: payload,
			signal: options.signal,
		});

		if (!response.ok) {
			throw await toGatewayError(response);
		}

		log.debug(options.op, 'response ok', { action: options.action, status: response.status });
		return response;
	}
}
