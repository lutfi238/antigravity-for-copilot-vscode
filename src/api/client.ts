import { DISCOVERY_ENDPOINTS, GENERATION_ENDPOINTS, userAgent } from './constants';
import { GatewayError, toGatewayError } from './errors';
import { httpFetch } from './http';
import { TokenManager } from '../auth/tokens';
import { log } from '../log';

export type EndpointSet = readonly string[];

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
