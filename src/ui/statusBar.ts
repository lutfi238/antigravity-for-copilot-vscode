import * as vscode from 'vscode';
import { Catalog, QuotaBucket } from '../api/models';
import { config } from '../config';

/**
 * Shows remaining Antigravity quota. Gemini and Claude/GPT are metered separately, so
 * both buckets are shown — a full Gemini bucket says nothing about Claude availability.
 */
export class QuotaStatusBar {
	private readonly item: vscode.StatusBarItem;

	constructor(context: vscode.ExtensionContext) {
		this.item = vscode.window.createStatusBarItem('antigravity.quota', vscode.StatusBarAlignment.Right, 90);
		this.item.name = 'Antigravity Quota';
		this.item.command = 'antigravity.manage';
		context.subscriptions.push(this.item);
	}

	setSignedOut(): void {
		this.item.text = '$(rocket) Antigravity: signed out';
		this.item.tooltip = 'Click to sign in to Antigravity.';
		this.render();
	}

	update(catalog: Catalog, email: string): void {
		const pro = format(catalog.quota['gemini-pro']);
		const flash = format(catalog.quota['gemini-flash']);
		const claude = format(catalog.quota.claude);

		const summary = [pro && `Pro ${pro}`, flash && `Flash ${flash}`, claude && `Claude ${claude}`]
			.filter(Boolean)
			.join(' · ');

		this.item.text = summary ? `$(rocket) ${summary}` : '$(rocket) Antigravity';

		const lines = [`Signed in as \`${email}\``, ''];
		if (catalog.isFallback) {
			// Say so plainly: otherwise a stale model list looks like the account's real roster.
			lines.push(
				'⚠️ **Model discovery failed.** Showing the built-in fallback roster, which may be out of date.',
				'Run `Antigravity: Open Logs` for the cause.',
				'',
			);
		}
		if (summary) {
			lines.push(
				`**Gemini Pro**: ${describe(catalog.quota['gemini-pro'])}`,
				`**Gemini Flash**: ${describe(catalog.quota['gemini-flash'])}`,
				`**Claude / GPT-OSS**: ${describe(catalog.quota.claude)}`,
			);
		} else {
			lines.push('The gateway reported no quota for this account.');
		}
		lines.push('', `${catalog.models.length} model(s) available.`, '', '_Click to manage accounts and refresh._');

		this.item.tooltip = new vscode.MarkdownString(lines.join('\n'));
		this.render();
	}

	private render(): void {
		if (config.showStatusBar()) {
			this.item.show();
		} else {
			this.item.hide();
		}
	}
}

function format(bucket: QuotaBucket | undefined): string | undefined {
	if (bucket?.remainingFraction === undefined) {
		return undefined;
	}
	return `${Math.round(bucket.remainingFraction * 100)}%`;
}

function describe(bucket: QuotaBucket | undefined): string {
	if (!bucket || bucket.remainingFraction === undefined) {
		return 'not reported';
	}
	const percent = `${Math.round(bucket.remainingFraction * 100)}% remaining`;
	if (!bucket.resetTime) {
		return percent;
	}
	const at = Date.parse(bucket.resetTime);
	if (Number.isNaN(at)) {
		return percent;
	}
	return `${percent}, resets ${new Date(at).toLocaleString()}`;
}
