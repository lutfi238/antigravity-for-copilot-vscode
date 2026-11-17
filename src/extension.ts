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
import { registerAntigravityImageGenerationTool } from './imageGeneration';
import { registerAntigravityWebSearchTool } from './webSearch';
import { ImageArtifactStore } from './imageArtifacts';
import { AccountPlanService } from './api/accountPlan';
import { GeminiQuotaService } from './api/geminiQuota';
import { registerDevProbe } from './devProbe';

export function activate(context: vscode.ExtensionContext): void {
	initLogging(context);
	log.info('activate', 'extension activating', { version: context.extension.packageJSON.version });

	const store = new AccountStore(context);
	const tokens = new TokenManager(store);
	const client = new GatewayClient(tokens);
	const projects = new ProjectResolver(client, store);
	const statusBar = new QuotaStatusBar(context);
	const imageArtifacts = new ImageArtifactStore(context.globalStorageUri.fsPath);
	const plans = new AccountPlanService(client);
	const geminiQuota = new GeminiQuotaService(client);
	context.subscriptions.push(plans, geminiQuota);

	const provider = new AntigravityProvider(context, store, tokens, client, projects, statusBar, imageArtifacts, plans, geminiQuota);
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
		registerAntigravityImageGenerationTool(imageArtifacts),
		registerAntigravityWebSearchTool(),
		onModelAffectingChange(() => provider.refresh()),
	);

	// Contract probing is a development tool: it spends real quota against an
	// undocumented endpoint, so a packaged build must not expose it. Two gates: the
	// bundler drops the import entirely under `--production` (`__DEV_PROBE__` is false,
	// so this block is dead code), and `ExtensionMode` keeps it out of any installed copy.
	if (__DEV_PROBE__ && context.extensionMode === vscode.ExtensionMode.Development) {
		registerDevProbe(context, client, projects);
		// The command is contributed in package.json but hidden from the palette unless
		// this key is set, which only a development build does. Without the contribution
		// VS Code would not list it at all; without the key a packaged build would.
		void vscode.commands.executeCommand('setContext', 'antigravity.devProbe', true);
		log.info('activate', 'dev probe registered', { command: 'antigravity.dev.probeEfforts' });
	}

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
