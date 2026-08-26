import * as vscode from 'vscode';
import { GatewayClient } from './api/client';
import { AccountStore } from './auth/store';
import { TokenManager } from './auth/tokens';
import { ProjectResolver } from './auth/project';
import { onModelAffectingChange } from './config';
import { initLogging, log, showLogs } from './log';
import { AntigravityProvider, VENDOR } from './provider';
import { manage, ManageDeps, showAuthStatus, signIn } from './ui/manage';
import { QuotaStatusBar } from './ui/statusBar';

export function activate(context: vscode.ExtensionContext): void {
	initLogging(context);
	log.info('activate', 'extension activating', { version: context.extension.packageJSON.version });

	const store = new AccountStore(context);
	const tokens = new TokenManager(store);
	const client = new GatewayClient(tokens);
	const projects = new ProjectResolver(client, store);
	const statusBar = new QuotaStatusBar(context);

	const provider = new AntigravityProvider(context, store, tokens, client, projects, statusBar);
	const deps: ManageDeps = {
		store,
		tokens,
		refresh: () => provider.refresh(),
		extensionId: context.extension.id,
	};

	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
		vscode.commands.registerCommand('antigravity.manage', () => manage(deps)),
		vscode.commands.registerCommand('antigravity.signIn', () => signIn(deps)),
		vscode.commands.registerCommand('antigravity.showAuthStatus', () => showAuthStatus(deps)),
		vscode.commands.registerCommand('antigravity.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('antigravity.openLogs', () => showLogs()),
		onModelAffectingChange(() => provider.refresh()),
	);

	void store.active().then((account) => {
		if (!account) {
			statusBar.setSignedOut();
		}
	});

	log.info('activate', 'provider registered', { vendor: VENDOR });
}

export function deactivate(): void {
	// Everything is disposed via context.subscriptions.
}
