import * as vscode from 'vscode';
import { AccountStore } from '../auth/store';
import { TokenManager } from '../auth/tokens';
import { showLogs } from '../log';

export interface ManageDeps {
	store: AccountStore;
	tokens: TokenManager;
	refresh: () => void;
	/** Taken from the extension context, so it survives a publisher rename. */
	extensionId: string;
}

export async function manage(deps: ManageDeps): Promise<void> {
	const accounts = await deps.store.all();
	const active = await deps.store.active();

	const items: Array<vscode.QuickPickItem & { id: string }> = [];

	if (active) {
		items.push({
			id: 'noop',
			label: `$(account) ${active.email}`,
			description: 'active account',
			kind: vscode.QuickPickItemKind.Default,
		});
	}

	items.push({ id: 'signin', label: '$(sign-in) Sign in with Google', description: accounts.length ? 'add another account' : undefined });

	if (accounts.length > 1) {
		items.push({ id: 'switch', label: '$(arrow-swap) Switch Account' });
	}
	if (accounts.length > 0) {
		items.push({ id: 'remove', label: '$(trash) Remove Account' });
		items.push({ id: 'signout', label: '$(sign-out) Sign Out (All Accounts)' });
	}

	items.push({ id: 'refresh', label: '$(refresh) Refresh Models and Quota' });
	items.push({ id: 'logs', label: '$(output) Open Logs' });
	items.push({ id: 'settings', label: '$(gear) Open Settings' });

	const pick = await vscode.window.showQuickPick(items, {
		title: 'Antigravity',
		placeHolder: active ? `Signed in as ${active.email}` : 'Not signed in',
	});

	switch (pick?.id) {
		case 'signin':
			await signIn(deps);
			break;
		case 'switch':
			await switchAccount(deps);
			break;
		case 'remove':
			await removeAccount(deps);
			break;
		case 'signout':
			await signOut(deps);
			break;
		case 'refresh':
			deps.refresh();
			vscode.window.showInformationMessage('Antigravity: models and quota refreshed.');
			break;
		case 'logs':
			showLogs();
			break;
		case 'settings':
			await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${deps.extensionId}`);
			break;
	}
}

export async function signIn(deps: ManageDeps): Promise<void> {
	try {
		const account = await deps.tokens.addAccount();
		deps.refresh();
		vscode.window.showInformationMessage(`Antigravity: signed in as ${account.email}.`);
	} catch (error) {
		if (error instanceof vscode.CancellationError) {
			return;
		}
		vscode.window.showErrorMessage(`Antigravity sign-in failed: ${(error as Error).message}`);
	}
}

async function switchAccount(deps: ManageDeps): Promise<void> {
	const accounts = await deps.store.all();
	const active = await deps.store.active();
	const pick = await vscode.window.showQuickPick(
		accounts.map((a) => ({
			label: a.email,
			description: a.email === active?.email ? 'current' : undefined,
			email: a.email,
		})),
		{ title: 'Switch Antigravity Account' },
	);
	if (pick) {
		await deps.store.switchTo(pick.email);
		vscode.window.showInformationMessage(`Antigravity: switched to ${pick.email}.`);
	}
}

async function removeAccount(deps: ManageDeps): Promise<void> {
	const accounts = await deps.store.all();
	const pick = await vscode.window.showQuickPick(
		accounts.map((a) => ({ label: a.email, email: a.email })),
		{ title: 'Remove Antigravity Account' },
	);
	if (!pick) {
		return;
	}
	const confirm = await vscode.window.showWarningMessage(
		`Remove ${pick.email}? This only deletes the credentials stored by this extension.`,
		{ modal: true },
		'Remove',
	);
	if (confirm === 'Remove') {
		await deps.store.remove(pick.email);
		vscode.window.showInformationMessage(`Antigravity: removed ${pick.email}.`);
	}
}

async function signOut(deps: ManageDeps): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		'Sign out of all Antigravity accounts? This only deletes the credentials stored by this extension — your Google account is untouched.',
		{ modal: true },
		'Sign Out',
	);
	if (confirm === 'Sign Out') {
		await deps.store.clear();
		vscode.window.showInformationMessage('Antigravity: signed out.');
	}
}

export async function showAuthStatus(deps: ManageDeps): Promise<void> {
	const accounts = await deps.store.all();
	const active = await deps.store.active();
	if (accounts.length === 0) {
		vscode.window.showInformationMessage('Antigravity: not signed in.');
		return;
	}
	const lines = accounts.map((a) => `${a.email === active?.email ? '● ' : '○ '}${a.email}`);
	vscode.window.showInformationMessage(`Antigravity accounts:\n${lines.join('\n')}`, { modal: true });
}
