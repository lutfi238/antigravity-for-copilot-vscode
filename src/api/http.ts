import * as vscode from 'vscode';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { log } from '../log';

let cached: { url: string | undefined; agent: ProxyAgent | undefined } | undefined;

/**
 * Resolves the proxy the same way VS Code itself does: the `http.proxy` setting wins,
 * then the standard environment variables.
 */
function proxyUrl(target: string): string | undefined {
	const configured = vscode.workspace.getConfiguration('http').get<string>('proxy')?.trim();
	const fromEnv =
		process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
	const url = configured || fromEnv;
	if (!url) {
		return undefined;
	}
	return isBypassed(target) ? undefined : url;
}

function isBypassed(target: string): boolean {
	const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
	if (!noProxy) {
		return false;
	}
	let host: string;
	try {
		host = new URL(target).hostname;
	} catch {
		return false;
	}
	return noProxy
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean)
		.some((entry) => entry === '*' || host === entry || host.endsWith(entry.startsWith('.') ? entry : `.${entry}`));
}

function agentFor(url: string): ProxyAgent {
	if (cached?.url === url && cached.agent) {
		return cached.agent;
	}
	log.info('http', 'using proxy');
	const agent = new ProxyAgent(url);
	cached = { url, agent };
	return agent;
}

/**
 * Performs a request, routing through a proxy when one is configured.
 *
 * Without a proxy we deliberately use the platform `fetch` rather than undici's, so
 * VS Code's own network patching (certificates, corporate interception) still applies.
 */
export async function httpFetch(url: string, init: RequestInit): Promise<Response> {
	const proxy = proxyUrl(url);
	if (!proxy) {
		return fetch(url, init);
	}
	return undiciFetch(url, { ...init, dispatcher: agentFor(proxy) } as never) as unknown as Response;
}
