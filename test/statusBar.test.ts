import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { fetchCatalog } from '../src/api/models';
import { GatewayClient } from '../src/api/client';
import { QuotaStatusBar } from '../src/ui/statusBar';

const item = vi.hoisted(() => ({
	text: '', tooltip: undefined as unknown, name: '', command: '',
	show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
}));

vi.mock('vscode', async (importOriginal) => ({
	...await importOriginal<typeof import('vscode')>(),
	StatusBarAlignment: { Right: 2 },
	MarkdownString: class { constructor(public value: string) {} },
	window: { createStatusBarItem: () => item },
}));
vi.mock('../src/config', () => ({ config: { showStatusBar: () => true } }));

describe('QuotaStatusBar', () => {
	let bar: QuotaStatusBar;
	beforeEach(() => {
		vi.clearAllMocks();
		item.text = '';
		item.tooltip = undefined;
		bar = new QuotaStatusBar({ subscriptions: [] } as unknown as vscode.ExtensionContext);
	});

	it('renders one Gemini percentage from Pro and Flash discovery and preserves Claude/GPT', async () => {
		const client = { postJson: vi.fn().mockResolvedValue({ models: {
			'gemini-3.1-pro-high': { quotaInfo: { remainingFraction: 0.8 } },
			'gemini-3.8-flash-low': { quotaInfo: { remainingFraction: 0.95 } },
			'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 0.4 } },
			'gpt-oss-120b-medium': { quotaInfo: { remainingFraction: 0.3 } },
		} }) } as unknown as GatewayClient;

		bar.update(await fetchCatalog(client, 'test', 'test-project'), 'test@example.com');

		expect(item.text).toBe('$(rocket) Gemini 80% · Claude 30%');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Gemini (all models)**: 80% remaining') });
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Claude / GPT-OSS**: 30% remaining') });
		expect(item.command).toBe('antigravity.manage');
		expect(item.show).toHaveBeenCalled();
	});

	it('shows exhausted Gemini quota while an unreported Claude quota stays absent', () => {
		bar.update({ models: [], quota: { gemini: { remainingFraction: 0, modelCount: 2 } }, isFallback: false }, 'test@example.com');
		expect(item.text).toBe('$(rocket) Gemini 0%');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Claude / GPT-OSS**: not reported') });
	});

	it('does not invent a percentage when discovery falls back', () => {
		bar.update({ models: [], quota: {}, isFallback: true }, 'test@example.com');
		expect(item.text).toBe('$(rocket) Antigravity');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('Model discovery failed.') });
	});
});
