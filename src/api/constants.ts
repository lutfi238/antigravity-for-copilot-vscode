/**
 * Wire constants for the Antigravity gateway, matched against the shipping
 * `@cortexkit/antigravity-auth-core` client.
 *
 * These target `v1internal` endpoints Google does not document, pinned to a specific
 * Antigravity CLI build. When the gateway starts 404-ing or rejecting requests, this
 * file is the first place to look.
 */

// Provider credentials live outside version control; see credentials.example.ts.
export { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET } from './credentials';

export const OAUTH_REDIRECT_PORT = 51121;
export const OAUTH_REDIRECT_PATH = '/oauth-callback';
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}${OAUTH_REDIRECT_PATH}`;

export const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const OAUTH_SCOPES = [
	'https://www.googleapis.com/auth/cloud-platform',
	'https://www.googleapis.com/auth/userinfo.email',
	'https://www.googleapis.com/auth/userinfo.profile',
	'https://www.googleapis.com/auth/cclog',
	'https://www.googleapis.com/auth/experimentsandconfigs',
] as const;

/**
 * Note the host: `daily-cloudcode-pa.googleapis.com`, NOT the `.sandbox.` variant.
 * The sandbox hostname does not serve this API and yields 404s on every call.
 */
export const ENDPOINT_DAILY = 'https://daily-cloudcode-pa.googleapis.com';
export const ENDPOINT_PROD = 'https://cloudcode-pa.googleapis.com';

/** Generation traffic: daily first, prod as backup. Autopush is no longer served. */
export const GENERATION_ENDPOINTS = [ENDPOINT_DAILY, ENDPOINT_PROD] as const;

/** Project discovery and model listing. */
export const DISCOVERY_ENDPOINTS = [ENDPOINT_PROD, ENDPOINT_DAILY] as const;

/** Used when the gateway returns no project (e.g. Workspace accounts). */
export const FALLBACK_PROJECT_ID = 'rising-fact-p41fc';

const AGY_CLI_VERSION = '1.1.13';
const AGY_CLI_CHANGE_LIST = '964361259';

/**
 * A single stable client identity, matching the Antigravity CLI's own.
 *
 * Content requests send ONLY this header — no `X-Goog-Api-Client`, no
 * `Client-Metadata`, and no `Accept`. The response format is selected by `?alt=sse`
 * on the URL, and adding an Accept header makes the request diverge from the real
 * client for no benefit.
 */
export function userAgent(): string {
	const osType = process.platform === 'win32' ? 'windows' : process.platform;
	const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'ia32' ? '386' : process.arch;
	return (
		`antigravity/cli/${AGY_CLI_VERSION} (aidev_client; os_type=${osType}; ` +
		`arch=${arch}; cl=${AGY_CLI_CHANGE_LIST}; auth_method=consumer)`
	);
}

/** Metadata for `loadCodeAssist` / `onboardUser`. Deliberately minimal. */
export function bootstrapMetadata(): Record<string, string> {
	return { ideType: 'ANTIGRAVITY' };
}
