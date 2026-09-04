import * as vscode from 'vscode';
import { runAgySearch } from './agyCli';

export const ANTIGRAVITY_WEB_SEARCH_TOOL_NAME = 'antigravity_web_search';

interface WebSearchInput {
	query: string;
}

/** Registers the Antigravity-native search marker that Copilot can attach to requests. */
export function registerAntigravityWebSearchTool(): vscode.Disposable {
	return vscode.lm.registerTool<WebSearchInput>(ANTIGRAVITY_WEB_SEARCH_TOOL_NAME, {
		prepareInvocation: () => ({ invocationMessage: 'Searching the web with Antigravity…' }),
		invoke: async (options, token) => {
			try {
				const answer = await runAgySearch(options.input.query, token);
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(answer)]);
			} catch (error) {
				if (error instanceof vscode.CancellationError) {
					throw error;
				}
				const message = error instanceof Error ? error.message : 'Unknown search error.';
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Antigravity web search failed: ${message}`),
				]);
			}
		},
	});
}
