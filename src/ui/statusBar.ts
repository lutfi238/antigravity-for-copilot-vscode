import * as vscode from 'vscode';
import { Catalog, QuotaBucket } from '../api/models';
import { AccountPlan } from '../api/accountPlan';
import { config } from '../config';

export interface QuotaStatusDetails {
	/** Undefined while loading, {} when the backend does not report a plan. */
	plan?: AccountPlan;
	modelCount?: number;
	updatedAt?: number;
}

/** Compact summary in the bar; account, plan and separate quota blocks in the tooltip. */
export class QuotaStatusBar {
	private readonly item: vscode.StatusBarItem;
	private snapshot?: { catalog: Catalog; email: string; details: QuotaStatusDetails };

	constructor(context: vscode.ExtensionContext) {
		this.item = vscode.window.createStatusBarItem('antigravity.quota', vscode.StatusBarAlignment.Right, 90);
		this.item.name = 'Antigravity Quota';
		this.item.command = 'antigravity.manage';
		context.subscriptions.push(this.item);
	}

	setLoading(): void {
		this.snapshot = undefined;
		this.item.text = '$(sync~spin) Antigravity';
		this.item.tooltip = 'Refreshing account and quota…';
		this.item.accessibilityInformation = { label: 'Antigravity: refreshing account and quota' };
		this.render();
	}

	setSignedOut(): void {
		this.snapshot = undefined;
		this.item.text = '$(rocket) Antigravity: signed out';
		this.item.tooltip = 'Click to sign in to Antigravity.';
		this.item.accessibilityInformation = { label: 'Antigravity: signed out' };
		this.render();
	}

	update(catalog: Catalog, email: string, details: QuotaStatusDetails = {}): void {
		this.snapshot = { catalog, email, details: { ...details, updatedAt: details.updatedAt ?? Date.now() } };
		this.updateDisplay();
	}

	/** Ignore background results for an account that is no longer on screen. */
	setPlan(email: string, plan: AccountPlan): void {
		if (!this.snapshot || this.snapshot.email !== email) return;
		this.snapshot.details.plan = plan;
		this.updateDisplay();
	}

	private updateDisplay(): void {
		const { catalog, email, details } = this.snapshot!;
		const gemini = format(catalog.quota.gemini);
		const argon = format(catalog.quota.argon);
		const claude = format(catalog.quota.claude);
		const plan = details.plan?.label;
		const credits = details.plan?.aiCredits === undefined ? undefined : BigInt(details.plan.aiCredits).toLocaleString();
		const summary = [
			plan && shortPlan(plan),
			gemini && `Gemini ${gemini}`,
			argon && `Argon ${argon}`,
			claude && `Claude/GPT ${claude}`,
			credits !== undefined && `Credits ${credits}`,
		].filter(Boolean).join(' · ');
		this.item.text = summary ? `$(rocket) ${summary}` : '$(rocket) Antigravity';

		const blocks = [
			'**Antigravity**',
			`Account: ${escapeMarkdown(email)}  \nPlan: **${plan ? escapeMarkdown(plan) : details.plan === undefined ? 'Loading…' : 'Not reported'}**`,
		];
		if (catalog.isFallback) {
			blocks.push('**Model discovery failed.** Showing fallback models; quota is unavailable. Refresh or open Antigravity logs.');
		}
		blocks.push(
			quotaBlock('Gemini', catalog.quota.gemini),
			quotaBlock('Gemini 4 Argon', catalog.quota.argon),
			quotaBlock('Claude / GPT-OSS', catalog.quota.claude),
			`**AI credits**  \nBalance: **${credits ?? (details.plan === undefined ? 'Loading…' : 'Not reported')}**  \nGoogle One account balance, separate from model quota.`,
			'---',
			`Models in picker: **${details.modelCount ?? catalog.models.length}**${catalog.isFallback ? ' (fallback)' : ''}  \nQuota updated: ${new Date(details.updatedAt!).toLocaleTimeString()} · local time`,
			'_Plan and credits cached up to 5 minutes. Click to manage accounts and refresh._',
		);
		// Blank paragraphs and explicit hard breaks keep quota groups from running together.
		this.item.tooltip = new vscode.MarkdownString(blocks.join('\n\n'));
		this.item.accessibilityInformation = {
			label: `Antigravity. Plan: ${plan ?? (details.plan === undefined ? 'loading' : 'not reported')}. Gemini: ${gemini ?? 'not reported'}. Argon: ${argon ?? 'not reported'}. Claude and GPT-OSS: ${claude ?? 'not reported'}. AI credits: ${credits ?? (details.plan === undefined ? 'loading' : 'not reported')}.`,
		};
		this.render();
	}

	private render(): void {
		if (config.showStatusBar()) this.item.show();
		else this.item.hide();
	}
}

function format(bucket: QuotaBucket | undefined): string | undefined {
	return bucket?.remainingFraction === undefined ? undefined : `${Math.round(bucket.remainingFraction * 100)}%`;
}

function quotaBlock(label: string, bucket: QuotaBucket | undefined): string {
	const percent = format(bucket);
	const lines = [`**${label}**`, `Remaining: **${percent ?? 'Not reported'}**`];
	const reset = bucket?.resetTime ? Date.parse(bucket.resetTime) : NaN;
	if (Number.isFinite(reset)) {
		lines.push(`Reset: ${new Date(reset).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`);
	}
	return lines.join('  \n');
}

function escapeMarkdown(value: string): string {
	return value.replace(/[\r\n]/g, ' ').replace(/[\\`*_{}[\]()<>#!|]/g, '\\$&');
}

function shortPlan(value: string): string {
	const plain = value.replace(/[\r\n]/g, ' ').replace(/\$\(/g, '(');
	return plain.length > 24 ? `${plain.slice(0, 23)}…` : plain;
}
