import * as vscode from 'vscode';
import { Account, AccountStore } from './store';
import { refresh, signIn } from './oauth';
import { log } from '../log';

/** Refresh this far ahead of expiry so a request never races the boundary. */
const SKEW_MS = 5 * 60_000;

interface CachedToken {
	accessToken: string;
	expiresAt: number;
}

/**
 * Owns access-token lifecycle. Access tokens are held in memory only; the refresh
 * token is the sole persisted credential.
 *
 * Concurrent chat requests all hit this at once, so refreshes are single-flighted per
 * account — otherwise several parallel refreshes would race and Google would start
 * invalidating the losers.
 */
export class TokenManager {
	private readonly cache = new Map<string, CachedToken>();
	private readonly inFlight = new Map<string, Promise<string>>();

	constructor(private readonly store: AccountStore) {}

	/** Returns a valid access token for the active account, refreshing if needed. */
	async accessToken(): Promise<string> {
		const account = await this.store.active();
		if (!account) {
			throw new Error('Not signed in to Antigravity.');
		}
		return this.accessTokenFor(account);
	}

	async accessTokenFor(account: Account): Promise<string> {
		const cached = this.cache.get(account.email);
		if (cached && cached.expiresAt - SKEW_MS > Date.now()) {
			return cached.accessToken;
		}

		const existing = this.inFlight.get(account.email);
		if (existing) {
			return existing;
		}

		const pending = this.doRefresh(account).finally(() => this.inFlight.delete(account.email));
		this.inFlight.set(account.email, pending);
		return pending;
	}

	/** Drops the cached access token so the next call forces a refresh. */
	invalidate(email: string): void {
		this.cache.delete(email);
	}

	async invalidateActive(): Promise<void> {
		const account = await this.store.active();
		if (account) {
			this.invalidate(account.email);
		}
	}

	private async doRefresh(account: Account): Promise<string> {
		log.info('tokens', 'refreshing access token');
		const tokens = await refresh(account.refreshToken);
		this.cache.set(account.email, { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });

		// Google rotates refresh tokens occasionally; persist the new one when it changes.
		if (tokens.refreshToken && tokens.refreshToken !== account.refreshToken) {
			log.info('tokens', 'refresh token rotated');
			await this.store.upsert({ ...account, refreshToken: tokens.refreshToken });
		}
		return tokens.accessToken;
	}

	/** Runs the interactive sign-in and persists the resulting account. */
	async addAccount(): Promise<Account> {
		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Signing in to Antigravity…', cancellable: true },
			async (_progress, token) => {
				const result = await signIn(token);
				const account: Account = { email: result.email, refreshToken: result.refreshToken };
				this.cache.set(account.email, { accessToken: result.accessToken, expiresAt: result.expiresAt });
				await this.store.upsert(account);
				return account;
			},
		);
	}
}
