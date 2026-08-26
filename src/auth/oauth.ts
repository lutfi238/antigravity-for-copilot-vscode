import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import {
	OAUTH_AUTHORIZE_URL,
	OAUTH_CLIENT_ID,
	OAUTH_CLIENT_SECRET,
	OAUTH_REDIRECT_PATH,
	OAUTH_REDIRECT_PORT,
	OAUTH_REDIRECT_URI,
	OAUTH_SCOPES,
	OAUTH_TOKEN_URL,
	OAUTH_USERINFO_URL,
} from '../api/constants';
import { log, newOperationId, redact } from '../log';
import { httpFetch } from '../api/http';

export interface TokenSet {
	accessToken: string;
	refreshToken: string;
	/** Absolute epoch milliseconds at which the access token expires. */
	expiresAt: number;
}

export interface SignInResult extends TokenSet {
	email: string;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
}

/**
 * Runs the full browser sign-in: PKCE challenge, a one-shot loopback listener, and the
 * authorization-code exchange.
 *
 * The listener must bind port 51121 because that exact redirect URI is registered with
 * the OAuth client — if the port is taken we fail loudly rather than silently picking
 * another one, which Google would reject anyway.
 */
export async function signIn(token: vscode.CancellationToken): Promise<SignInResult> {
	const op = newOperationId();
	const verifier = base64url(crypto.randomBytes(32));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	const state = base64url(crypto.randomBytes(16));

	const server = await listen(op, state);
	try {
		const url = new URL(OAUTH_AUTHORIZE_URL);
		url.searchParams.set('client_id', OAUTH_CLIENT_ID);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
		url.searchParams.set('scope', OAUTH_SCOPES.join(' '));
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');
		url.searchParams.set('state', state);
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'consent');

		// asExternalUri makes the loopback reachable from Remote-SSH / Codespaces by
		// establishing a port forward; locally it is a no-op.
		await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${OAUTH_REDIRECT_PORT}`));
		await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
		log.info(op, 'authorization url opened');

		const code = await server.waitForCode(token);
		const tokens = await exchange(op, {
			grant_type: 'authorization_code',
			code,
			code_verifier: verifier,
			redirect_uri: OAUTH_REDIRECT_URI,
		});

		if (!tokens.refreshToken) {
			throw new Error('Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and sign in again.');
		}

		const email = await fetchEmail(op, tokens.accessToken);
		log.info(op, 'sign-in complete');
		return { ...tokens, email };
	} finally {
		server.close();
	}
}

/** Trades a refresh token for a fresh access token. */
export async function refresh(refreshToken: string): Promise<TokenSet> {
	const op = newOperationId();
	const tokens = await exchange(op, { grant_type: 'refresh_token', refresh_token: refreshToken });
	// Google usually omits refresh_token on refresh; keep the one we already hold.
	return { ...tokens, refreshToken: tokens.refreshToken || refreshToken };
}

async function exchange(op: string, params: Record<string, string>): Promise<TokenSet> {
	const body = new URLSearchParams({
		client_id: OAUTH_CLIENT_ID,
		client_secret: OAUTH_CLIENT_SECRET,
		...params,
	});

	const response = await httpFetch(OAUTH_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});

	if (!response.ok) {
		const detail = redact(await response.text().catch(() => ''));
		log.error(op, 'token exchange failed', { status: response.status });
		throw new Error(`Token exchange failed (${response.status}): ${detail.slice(0, 300)}`);
	}

	const json = (await response.json()) as TokenResponse;
	return {
		accessToken: json.access_token,
		refreshToken: json.refresh_token ?? '',
		expiresAt: Date.now() + json.expires_in * 1000,
	};
}

async function fetchEmail(op: string, accessToken: string): Promise<string> {
	try {
		const response = await httpFetch(OAUTH_USERINFO_URL, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!response.ok) {
			return 'unknown';
		}
		const json = (await response.json()) as { email?: string };
		return json.email ?? 'unknown';
	} catch (error) {
		log.warn(op, 'userinfo lookup failed', { error });
		return 'unknown';
	}
}

interface CallbackServer {
	waitForCode(token: vscode.CancellationToken): Promise<string>;
	close(): void;
}

async function listen(op: string, expectedState: string): Promise<CallbackServer> {
	let resolveCode: (code: string) => void;
	let rejectCode: (error: Error) => void;
	const pending = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});

	const server = http.createServer((req, res) => {
		const requestUrl = new URL(req.url ?? '/', `http://localhost:${OAUTH_REDIRECT_PORT}`);
		if (requestUrl.pathname !== OAUTH_REDIRECT_PATH) {
			res.writeHead(404).end();
			return;
		}

		const error = requestUrl.searchParams.get('error');
		const code = requestUrl.searchParams.get('code');
		const state = requestUrl.searchParams.get('state');

		if (error) {
			respond(res, 'Sign-in failed', `Google returned: ${error}`);
			rejectCode(new Error(`Authorization denied: ${error}`));
			return;
		}
		if (!code) {
			respond(res, 'Sign-in failed', 'No authorization code was returned.');
			rejectCode(new Error('No authorization code in callback'));
			return;
		}
		if (state !== expectedState) {
			// A mismatched state means this callback did not originate from our request.
			respond(res, 'Sign-in failed', 'State mismatch — the request could not be verified.');
			rejectCode(new Error('OAuth state mismatch'));
			return;
		}

		respond(res, 'Signed in', 'You can close this tab and return to VS Code.');
		resolveCode(code);
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				reject(
					new Error(
						`Port ${OAUTH_REDIRECT_PORT} is already in use. Google only accepts this exact ` +
							`redirect port, so it must be free. Close whatever is using it (Antigravity ` +
							`itself, or another sign-in in progress) and try again.`,
					),
				);
			} else {
				reject(err);
			}
		});
		server.listen(OAUTH_REDIRECT_PORT, '127.0.0.1', resolve);
	});

	log.info(op, 'callback listener started', { port: OAUTH_REDIRECT_PORT });

	return {
		waitForCode(cancellation) {
			return Promise.race([
				pending,
				new Promise<string>((_, reject) => {
					const sub = cancellation.onCancellationRequested(() => {
						sub.dispose();
						reject(new vscode.CancellationError());
					});
				}),
				new Promise<string>((_, reject) =>
					setTimeout(() => reject(new Error('Sign-in timed out after 5 minutes')), 5 * 60_000).unref?.(),
				),
			]);
		},
		close() {
			server.close();
		},
	};
}

function respond(res: http.ServerResponse, title: string, detail: string): void {
	res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
	res.end(
		`<!doctype html><meta charset="utf-8"><title>${title}</title>` +
			`<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
			`<div style="text-align:center"><h1 style="font-weight:600">${title}</h1><p>${detail}</p></div>`,
	);
}

function base64url(buffer: Buffer): string {
	return buffer.toString('base64url');
}
