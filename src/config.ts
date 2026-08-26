import * as vscode from 'vscode';
import { ENDPOINT_DAILY, ENDPOINT_PROD, GENERATION_ENDPOINTS } from './api/constants';
import { ReasoningEffort } from './translate/thinking';

const SECTION = 'antigravity';

function get<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration(SECTION).get<T>(key) ?? fallback;
}

export const config = {
	reasoningEffort(): ReasoningEffort {
		return get<ReasoningEffort>('reasoningEffort', 'medium');
	},
	showThinking(): boolean {
		return get('showThinking', true);
	},
	projectId(): string | undefined {
		return get('projectId', '').trim() || undefined;
	},
	hiddenModels(): string[] {
		return get<string[]>('hiddenModels', []);
	},
	/** Fold a model's effort tiers into one picker entry, effort chosen by setting. */
	collapseTiers(): boolean {
		return get<string>('effortSelection', 'setting') !== 'tiers';
	},
	/** `all` keeps every generation and duplicate the gateway reports. */
	showAllModels(): boolean {
		return get<string>('modelSelection', 'latest') === 'all';
	},
	showStatusBar(): boolean {
		return get('showStatusBar', true);
	},
	/** Pins generation traffic to one host, for when the default chain misbehaves. */
	generationEndpoints(): readonly string[] {
		switch (get<string>('endpoint', 'auto')) {
			case 'daily':
				return [ENDPOINT_DAILY];
			case 'prod':
				return [ENDPOINT_PROD];
			default:
				return GENERATION_ENDPOINTS;
		}
	},
};

/** Fires when any setting that affects the model list changes. */
export function onModelAffectingChange(handler: () => void): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((event) => {
		if (
			event.affectsConfiguration(`${SECTION}.hiddenModels`) ||
			event.affectsConfiguration(`${SECTION}.modelSelection`) ||
			event.affectsConfiguration(`${SECTION}.effortSelection`) ||
			event.affectsConfiguration(`${SECTION}.projectId`)
		) {
			handler();
		}
	});
}
