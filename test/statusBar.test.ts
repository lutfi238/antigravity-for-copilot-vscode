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

		expect(item.text).toBe('$(rocket) Gemini 80% · Claude/GPT 30%');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Gemini**  \nRemaining: **80%**') });
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('\n\n**Claude / GPT-OSS**  \nRemaining: **30%**') });
		expect(item.command).toBe('antigravity.manage');
		expect(item.show).toHaveBeenCalled();
	});

	it('shows exhausted Gemini quota while an unreported Claude quota stays absent', () => {
		bar.update({ models: [], quota: { gemini: { remainingFraction: 0, modelCount: 2 } }, isFallback: false }, 'test@example.com');
		expect(item.text).toBe('$(rocket) Gemini 0%');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Claude / GPT-OSS**  \nRemaining: **Not reported**') });
	});

	it('shows credits as a separate balance, including zero, without changing Gemini quota', () => {
		bar.update({ models: [], quota: { gemini: { remainingFraction: .98, modelCount: 2 } }, isFallback: false },
			'test@example.com', { plan: { label: 'Pro', aiCredits: '1250' } });
		expect(item.text).toBe(`$(rocket) Pro · Gemini 98% · Credits ${1250n.toLocaleString()}`);
		expect((item.tooltip as any).value).toContain(`**AI credits**  \nBalance: **${1250n.toLocaleString()}**`);
		bar.setPlan('test@example.com', { label: 'Pro', aiCredits: '0' });
		expect(item.text).toBe('$(rocket) Pro · Gemini 98% · Credits 0');
		expect((item.tooltip as any).value).toContain('Balance: **0**');
		bar.setPlan('test@example.com', { label: 'Pro' });
		expect(item.text).not.toContain('Credits');
		expect((item.tooltip as any).value).toContain('Balance: **Not reported**');
		bar.update({ models: [], quota: {}, isFallback: false }, 'second@example.com');
		bar.setPlan('test@example.com', { aiCredits: '999' });
		expect((item.tooltip as any).value).toContain('Balance: **Loading…**');
		expect(item.text).not.toContain('999');
	});

	it('does not invent a percentage when discovery falls back', () => {
		bar.update({ models: [], quota: {}, isFallback: true }, 'test@example.com');
		expect(item.text).toBe('$(rocket) Antigravity');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('Model discovery failed.') });
	});

	it('shows plan and separate quota/reset blocks with the actual picker count', () => {
		bar.update({ models: Array(22).fill({}), quota: {
			gemini: { remainingFraction: .98, resetTime: '2026-10-15T02:12:53+07:00', modelCount: 15 },
			claude: { remainingFraction: 1, resetTime: '2026-10-15T03:31:03+07:00', modelCount: 7 },
		}, isFallback: false }, 'test@example.com', { plan: { label: 'Pro' }, modelCount: 4 });
		expect(item.text).toBe('$(rocket) Pro · Gemini 98% · Claude/GPT 100%');
		const tooltip = (item.tooltip as any).value;
		expect(tooltip).toContain('Plan: **Pro**');
		expect(tooltip).toContain('Models in picker: **4**');
		expect(tooltip).not.toContain('22 model');
		expect(tooltip.match(/Reset:/g)).toHaveLength(2);
		expect(tooltip).toContain('\n\n**Claude / GPT-OSS**');
	});

	it('renders all three quota allocations when Argon, Gemini and Claude are reported', () => {
		bar.update({ models: Array(25).fill({}), quota: {
			gemini: { remainingFraction: 0.95, resetTime: '2026-10-18T00:00:00Z', modelCount: 6 },
			argon: { remainingFraction: 0.5, resetTime: '2026-10-24T00:00:00Z', modelCount: 3 },
			claude: { remainingFraction: 0.8, resetTime: '2026-10-19T00:00:00Z', modelCount: 6 },
		}, isFallback: false }, 'test@example.com', { plan: { label: 'Pro' } });

		expect(item.text).toBe('$(rocket) Pro · Gemini 95% · Argon 50% · Claude/GPT 80%');
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Gemini**  \nRemaining: **95%**') });
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Gemini 4 Argon**  \nRemaining: **50%**') });
		expect(item.tooltip).toMatchObject({ value: expect.stringContaining('**Claude / GPT-OSS**  \nRemaining: **80%**') });
	});

	it('updates plan in the background without changing quota freshness', () => {
		const time = Date.parse('2026-10-14T12:00:00Z');
		bar.update({ models: [], quota: {}, isFallback: false }, 'test@example.com', { updatedAt: time });
		expect((item.tooltip as any).value).toContain('Plan: **Loading…**');
		bar.setPlan('test@example.com', { label: 'Ultra' });
		expect((item.tooltip as any).value).toContain('Plan: **Ultra**');
		expect((item.tooltip as any).value).toContain(new Date(time).toLocaleTimeString());
		bar.setPlan('test@example.com', {});
		expect((item.tooltip as any).value).toContain('Plan: **Not reported**');
	});

	it('does not leak a previous account plan after switching, refresh or sign-out', () => {
		const catalog = { models: [], quota: {}, isFallback: false };
		bar.update(catalog, 'first@example.com', { plan: { label: 'Pro' } });
		bar.update(catalog, 'second@example.com');
		bar.setPlan('first@example.com', { label: 'Ultra' });
		expect((item.tooltip as any).value).not.toContain('Ultra');
		bar.setLoading();
		bar.setPlan('second@example.com', { label: 'Ultra' });
		expect(item.text).toBe('$(sync~spin) Antigravity');
		bar.setSignedOut();
		bar.setPlan('second@example.com', { label: 'Ultra' });
		expect(item.text).toContain('signed out');
	});

	it('escapes account/plan Markdown and does not turn a backend name into a status icon', () => {
		bar.update({ models: [], quota: { gemini: { modelCount: 1, resetTime: 'invalid-date' } }, isFallback: false },
			'[account](command:evil)', { plan: { label: '$(warning) [Pro](command:evil)' } });
		expect(item.text).not.toContain('$(warning)');
		expect((item.tooltip as any).value).not.toContain('[account](command:evil)');
		expect((item.tooltip as any).value).not.toContain('Invalid Date');
	});
});
