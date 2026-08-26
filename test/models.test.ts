import { describe, expect, it, vi } from 'vitest';
import {
	fetchCatalog,
	spec,
	curateModels,
	collapseTiers,
	resolveTier,
	FALLBACK_MODELS,
} from '../src/api/models';

/** Stands in for GatewayClient, returning whatever the gateway is pretending to send. */
function clientReturning(payload: unknown) {
	return { postJson: vi.fn().mockResolvedValue(payload) } as any;
}

function clientThrowing(error: Error) {
	return { postJson: vi.fn().mockRejectedValue(error) } as any;
}

describe('fetchCatalog', () => {
	it('parses the model MAP the gateway actually returns', async () => {
		// This is the shape that matters: `models` is keyed by model id, not an array.
		// Treating it as an array yields an empty picker and no quota — indistinguishable
		// from an account with no access.
		const catalog = await fetchCatalog(
			clientReturning({
				models: {
					'gemini-3.1-pro-high': {
						displayName: 'Gemini 3.1 Pro (High)',
						quotaInfo: { remainingFraction: 0.8, resetTime: '2026-09-01T00:00:00Z' },
					},
					'gemini-3-flash-medium': {
						displayName: 'Gemini 3 Flash (Medium)',
						quotaInfo: { remainingFraction: 0.95 },
					},
					'claude-opus-4-6-thinking': {
						displayName: 'Claude Opus 4.6 (Thinking)',
						quotaInfo: { remainingFraction: 0.4 },
					},
				},
			}),
			'op',
			'proj',
		);

		expect(catalog.isFallback).toBe(false);
		expect(catalog.models.map((m) => m.id)).toEqual([
			'gemini-3.1-pro-high',
			'gemini-3-flash-medium',
			'claude-opus-4-6-thinking',
		]);
		expect(catalog.models[0].name).toBe('Gemini 3.1 Pro (High)');
	});

	it('separates Pro, Flash and Claude into distinct quota buckets', async () => {
		const catalog = await fetchCatalog(
			clientReturning({
				models: {
					'gemini-3.1-pro-high': { quotaInfo: { remainingFraction: 0.8 } },
					'gemini-3-flash-medium': { quotaInfo: { remainingFraction: 0.95 } },
					'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 0.4 } },
					'gpt-oss-120b-medium': { quotaInfo: { remainingFraction: 0.3 } },
				},
			}),
			'op',
			'proj',
		);

		expect(catalog.quota['gemini-pro']?.remainingFraction).toBe(0.8);
		expect(catalog.quota['gemini-flash']?.remainingFraction).toBe(0.95);
		// GPT shares the Claude bucket, and the tightest constraint wins.
		expect(catalog.quota.claude?.remainingFraction).toBe(0.3);
		expect(catalog.quota.claude?.modelCount).toBe(2);
	});

	it('keeps the earliest reset time within a bucket', async () => {
		const catalog = await fetchCatalog(
			clientReturning({
				models: {
					'gemini-3.1-pro-high': { quotaInfo: { remainingFraction: 0.5, resetTime: '2026-09-05T00:00:00Z' } },
					'gemini-3.1-pro-low': { quotaInfo: { remainingFraction: 0.9, resetTime: '2026-09-01T00:00:00Z' } },
				},
			}),
			'op',
			'proj',
		);
		expect(catalog.quota['gemini-pro']?.resetTime).toBe('2026-09-01T00:00:00Z');
	});

	it('falls back and flags itself when discovery throws', async () => {
		const catalog = await fetchCatalog(clientThrowing(new Error('403')), 'op', 'proj');
		expect(catalog.isFallback).toBe(true);
		expect(catalog.models).toEqual(FALLBACK_MODELS);
	});

	it('falls back when the gateway returns an empty model map', async () => {
		const catalog = await fetchCatalog(clientReturning({ models: {} }), 'op', 'proj');
		expect(catalog.isFallback).toBe(true);
	});

	it('clamps out-of-range quota fractions', async () => {
		const catalog = await fetchCatalog(
			clientReturning({ models: { 'gemini-3.1-pro-high': { quotaInfo: { remainingFraction: 1.7 } } } }),
			'op',
			'proj',
		);
		expect(catalog.quota['gemini-pro']?.remainingFraction).toBe(1);
	});

	it('still lists models the gateway reports no quota for', async () => {
		const catalog = await fetchCatalog(
			clientReturning({ models: { 'gemini-3.1-pro-high': {} } }),
			'op',
			'proj',
		);
		expect(catalog.isFallback).toBe(false);
		expect(catalog.models).toHaveLength(1);
		expect(catalog.quota['gemini-pro']?.remainingFraction).toBeUndefined();
	});
});

describe('spec', () => {
	it('routes Gemini 3 thinking through the model-id tier, not a budget', () => {
		expect(spec('gemini-3.1-pro-high', 'x').thinkingStyle).toBe('model-id-tier');
		expect(spec('gemini-3-flash-medium', 'x').thinkingStyle).toBe('model-id-tier');
	});

	it('gives Claude thinking models a numeric budget', () => {
		expect(spec('claude-opus-4-6-thinking', 'x').thinkingStyle).toBe('numeric-budget');
	});

	it('gives Claude Sonnet 4.6 a budget too — it is a thinking model', () => {
		expect(spec('claude-sonnet-4-6', 'x').thinkingStyle).toBe('numeric-budget');
	});

	it('gives non-reasoning models none', () => {
		expect(spec('gpt-oss-120b-medium', 'x').thinkingStyle).toBe('none');
		expect(spec('gemini-3.1-flash-image', 'x').thinkingStyle).toBe('none');
	});

	it('assigns family and limits from the model id', () => {
		expect(spec('gemini-pro-agent', 'x')).toMatchObject({ family: 'gemini', contextWindow: 1_048_576 });
		expect(spec('claude-sonnet-4-6', 'x')).toMatchObject({ family: 'claude', contextWindow: 250_000 });
		expect(spec('gpt-oss-120b-medium', 'x')).toMatchObject({ family: 'gpt-oss', contextWindow: 131_072 });
		expect(spec('gemini-3.1-flash-image', 'x')).toMatchObject({ contextWindow: 66_000 });
	});

	it('keeps the irregular top-tier aliases addressable', () => {
		// `gemini-pro-agent` and `gemini-3-flash-agent` are the real ids for the
		// highest tiers; "tidying" them into `-high` would 404.
		expect(spec('gemini-pro-agent', 'x').thinkingStyle).toBe('model-id-tier');
		expect(spec('gemini-3-flash-agent', 'x').thinkingStyle).toBe('model-id-tier');
	});
});

/** The roster actually observed in the model picker, warts and all. */
const OBSERVED: Array<[string, string]> = [
	['chat-20706', 'Chat_20706'],
	['chat-23310', 'Chat_23310'],
	['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'],
	['claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'],
	['gemini-2.5-pro', 'Gemini 2.5 Pro'],
	['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'],
	['gemini-3.1-flash-lite-a', 'Gemini 3.1 Flash Lite'],
	['gemini-3.1-flash-lite-b', 'Gemini 3.1 Flash Lite'],
	['gemini-3.1-flash-lite-c', 'Gemini 3.1 Flash Lite'],
	['gemini-3.1-flash-lite-d', 'Gemini 3.1 Flash Lite'],
	['gemini-pro-agent', 'Gemini 3.1 Pro (High)'],
	['gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)'],
	['gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)'],
	['gemini-3-flash-agent', 'Gemini 3.5 Flash (High)'],
	['gemini-3.5-flash-extra-low', 'Gemini 3.5 Flash (Low)'],
	['gemini-3.5-flash-low', 'Gemini 3.5 Flash (Medium)'],
	['gemini-3.6-flash-high', 'Gemini 3.6 Flash (High)'],
	['gemini-3.6-flash-low', 'Gemini 3.6 Flash (Low)'],
	['gemini-3.6-flash-medium', 'Gemini 3.6 Flash (Medium)'],
	['gemini-3.6-flash-tiered', 'Gemini 3.6 Flash Tiered'],
	['gemini-3.7-flash-low', 'Gemini 3.7 Flash (Low)'],
	['gemini-3.7-flash-medium', 'Gemini 3.7 Flash (Medium)'],
	['gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)'],
	['gemini-3.7-flash-tiered', 'Gemini 3.7 Flash Tiered'],
	['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)'],
	['tab-flash-lite-preview', 'Tab_flash_lite_preview'],
	['tab-jump-flash-lite-preview', 'Tab_jump_flash_lite_preview'],
];

describe('curateModels', () => {
	const raw = OBSERVED.map(([id, name]) => spec(id, name));
	const curated = curateModels(raw, false);
	const names = curated.map((m) => m.name);

	it('drops Tab, Chat, tiered and image models — none can serve a chat turn', () => {
		expect(names.some((n) => /^Tab_/.test(n))).toBe(false);
		expect(names.some((n) => /^Chat_/.test(n))).toBe(false);
		expect(names.some((n) => /Tiered/.test(n))).toBe(false);
		expect(names.some((n) => /Image/.test(n))).toBe(false);
	});

	it('keeps only the newest Flash generation', () => {
		expect(names).toContain('Gemini 3.7 Flash (High)');
		expect(names.some((n) => /3\.6 Flash|3\.5 Flash/.test(n))).toBe(false);
	});

	it('keeps every tier of the generation it kept', () => {
		expect(names).toEqual(
			expect.arrayContaining(['Gemini 3.7 Flash (High)', 'Gemini 3.7 Flash (Medium)', 'Gemini 3.7 Flash (Low)']),
		);
	});

	it('prunes Pro and Flash Lite on their own ladders, not against Flash', () => {
		// 3.1 Pro is the newest Pro even though 3.7 Flash exists.
		expect(names).toContain('Gemini 3.1 Pro (High)');
		expect(names).toContain('Gemini 3.1 Pro (Low)');
		expect(names).not.toContain('Gemini 2.5 Pro');
	});

	it('collapses the four identical Flash Lite entries into one', () => {
		expect(names.filter((n) => n === 'Gemini 3.1 Flash Lite')).toHaveLength(1);
	});

	it('deduplicates the two ids that share the Pro (High) name', () => {
		expect(names.filter((n) => n === 'Gemini 3.1 Pro (High)')).toHaveLength(1);
	});

	it('never prunes Claude or GPT-OSS, which have no generation ladder', () => {
		expect(names).toContain('Claude Opus 4.6 (Thinking)');
		expect(names).toContain('Claude Sonnet 4.6 (Thinking)');
		expect(names).toContain('GPT-OSS 120B (Medium)');
	});

	it('cuts the picker to a usable size', () => {
		expect(raw.length).toBe(27);
		expect(curated.length).toBeLessThanOrEqual(10);
	});

	it('keeps old generations under "all" but still drops the internals', () => {
		const all = curateModels(raw, true).map((m) => m.name);
		expect(all).toContain('Gemini 3.6 Flash (High)');
		expect(all).toContain('Gemini 2.5 Pro');
		expect(all.some((n) => /^Tab_|^Chat_|Tiered/.test(n))).toBe(false);
	});
});

describe('collapseTiers', () => {
	const curated = curateModels(OBSERVED.map(([id, name]) => spec(id, name)), false);
	const collapsed = collapseTiers(curated);
	const names = collapsed.map((m) => m.name);

	it('folds the three Flash tiers into one entry', () => {
		expect(names.filter((n) => n.startsWith('Gemini 3.7 Flash'))).toEqual(['Gemini 3.7 Flash']);
	});

	it('drops the tier suffix from names it actually collapsed', () => {
		expect(names).toContain('Gemini 3.1 Pro');
		expect(names).not.toContain('Gemini 3.1 Pro (High)');
	});

	it('keeps the suffix on a model that has only one tier', () => {
		// GPT-OSS is offered at medium only, so there is nothing to fold and the name
		// stays exactly as the gateway reported it.
		expect(names).toContain('GPT-OSS 120B (Medium)');
	});

	it('keeps every tier addressable through tierVariants', () => {
		const flash = collapsed.find((m) => m.name === 'Gemini 3.7 Flash')!;
		expect(flash.tierVariants).toEqual({
			high: 'gemini-3.7-flash-high',
			medium: 'gemini-3.7-flash-medium',
			low: 'gemini-3.7-flash-low',
		});
	});

	it('represents a group with its strongest tier, so an unset effort is no downgrade', () => {
		expect(collapsed.find((m) => m.name === 'Gemini 3.7 Flash')!.thinkingTier).toBe('high');
	});

	it('leaves untiered models untouched', () => {
		expect(names).toContain('Claude Opus 4.6 (Thinking)');
		expect(names).toContain('GPT-OSS 120B (Medium)');
		expect(names).toContain('Gemini 3.1 Flash Lite');
	});

	it('shortens the picker further than curation alone', () => {
		expect(collapsed.length).toBeLessThan(curated.length);
	});
});

describe('resolveTier', () => {
	const flash = collapseTiers(curateModels(OBSERVED.map(([id, name]) => spec(id, name)), false)).find(
		(m) => m.name === 'Gemini 3.7 Flash',
	)!;

	it('maps each effort to its own wire id', () => {
		expect(resolveTier(flash, 'high')).toBe('gemini-3.7-flash-high');
		expect(resolveTier(flash, 'medium')).toBe('gemini-3.7-flash-medium');
		expect(resolveTier(flash, 'low')).toBe('gemini-3.7-flash-low');
	});

	it('treats "off" as the cheapest tier, since a tiered model always thinks', () => {
		expect(resolveTier(flash, 'off')).toBe('gemini-3.7-flash-low');
	});

	it('falls back within the group when the wanted tier is absent', () => {
		const pro = { ...flash, tierVariants: { high: 'gemini-pro-agent', low: 'gemini-3.1-pro-low' } };
		expect(resolveTier(pro, 'medium')).toBe('gemini-pro-agent');
	});

	it('returns the id unchanged for an uncollapsed model', () => {
		expect(resolveTier(spec('claude-sonnet-4-6', 'Claude Sonnet 4.6'), 'high')).toBe('claude-sonnet-4-6');
	});
});
