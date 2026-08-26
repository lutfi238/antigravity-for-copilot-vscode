import * as vscode from 'vscode';
import { log } from '../log';

const SECRET_KEY = 'antigravity.accounts';
const ACTIVE_KEY = 'antigravity.activeAccount';

export interface Account {
	/** Google account email; the stable identity users pick between. */
	email: string;
	refreshToken: string;
	/** Cached Cloud Code project id, resolved on first use. */
	projectId?: string;
}

/**
 * Credential storage. Refresh tokens live in VS Code SecretStorage (OS keychain),
 * never on disk in plaintext. The active-account pointer is ordinary workspace state.
 */
export class AccountStore {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly context: vscode.ExtensionContext) {
		context.subscriptions.push(this._onDidChange);
	}

	async all(): Promise<Account[]> {
		const raw = await this.context.secrets.get(SECRET_KEY);
		if (!raw) {
			return [];
		}
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			log.warn('store', 'account store corrupt, resetting');
			return [];
		}
	}

	async active(): Promise<Account | undefined> {
		const accounts = await this.all();
		if (accounts.length === 0) {
			return undefined;
		}
		const email = this.context.globalState.get<string>(ACTIVE_KEY);
		return accounts.find((a) => a.email === email) ?? accounts[0];
	}

	async upsert(account: Account): Promise<void> {
		const accounts = await this.all();
		const index = accounts.findIndex((a) => a.email === account.email);
		if (index >= 0) {
			// Preserve a previously resolved project id if the new record lacks one.
			accounts[index] = { ...accounts[index], ...account };
		} else {
			accounts.push(account);
		}
		await this.write(accounts);
		await this.setActive(account.email);
		this._onDidChange.fire();
	}

	async remove(email: string): Promise<void> {
		const accounts = (await this.all()).filter((a) => a.email !== email);
		await this.write(accounts);
		if (this.context.globalState.get<string>(ACTIVE_KEY) === email) {
			await this.setActive(accounts[0]?.email);
		}
		this._onDidChange.fire();
	}

	async clear(): Promise<void> {
		await this.context.secrets.delete(SECRET_KEY);
		await this.setActive(undefined);
		this._onDidChange.fire();
	}

	async setActive(email: string | undefined): Promise<void> {
		await this.context.globalState.update(ACTIVE_KEY, email);
	}

	/** Switches the active account and notifies listeners. */
	async switchTo(email: string): Promise<void> {
		await this.setActive(email);
		this._onDidChange.fire();
	}

	/** Persists a resolved project id so discovery runs once per account. */
	async setProjectId(email: string, projectId: string): Promise<void> {
		const accounts = await this.all();
		const account = accounts.find((a) => a.email === email);
		if (!account || account.projectId === projectId) {
			return;
		}
		account.projectId = projectId;
		await this.write(accounts);
	}

	private async write(accounts: Account[]): Promise<void> {
		await this.context.secrets.store(SECRET_KEY, JSON.stringify(accounts));
	}
}
