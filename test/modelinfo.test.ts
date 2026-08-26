import { describe, expect, it } from 'vitest';
import { availableEfforts, buildConfigurationSchema, effortFromModelOptions } from '../src/api/modelInfo';
import { collapseTiers, curateModels, spec } from '../src/api/models';

const flash = collapseTiers(
	curateModels(
		[
			spec('gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)'),
			spec('gemini-3.7-flash-medium', 'Gemini 3.7 Flash (Medium)'),
			spec('gemini-3.7-flash-low', 'Gemini 3.7 Flash (Low)'),
		],
		false,
	),
	)[0];

const pro = collapseTiers(
	curateModels(
		[spec('gemini-pro-agent', 'Gemini 3.1 Pro (High)'), spec('gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)')],
		false,
	),
)[0];

describe('availableEfforts', () => {
	it('offers only the tiers the backend actually routes', () => {
		// Inventing a "medium" for Pro would produce a model id that 404s.
		expect(availableEfforts(flash)).toEqual(['low', 'medium', 'high']);
		expect(availableEfforts(pro)).toEqual(['low', 'high']);
	});

	it('offers all three to Claude, which takes an arbitrary budget', () => {
		expect(availableEfforts(spec('claude-opus-4-6-thinking', 'x'))).toEqual(['low', 'medium', 'high']);
	});

	it('offers none where there is nothing to vary', () => {
		expect(availableEfforts(spec('gpt-oss-120b-medium', 'x'))).toEqual([]);
	});
});

describe('buildConfigurationSchema', () => {
	it('builds the Thinking Effort control the picker renders', () => {
		const schema = buildConfigurationSchema(flash, 1_000_000, 'medium')!;
		expect(schema.properties.reasoningEffort).toEqual({
			type: 'string',
			title: 'Thinking Effort',
			enum: ['low', 'medium', 'high'],
			enumItemLabels: ['Low', 'Medium', 'High'],
			enumDescriptions: [expect.any(String), expect.any(String), expect.any(String)],
			default: 'medium',
			group: 'navigation',
		});
	});

	it('starts on the configured default when the model serves it', () => {
		expect(buildConfigurationSchema(flash, 1_000_000, 'low')!.properties.reasoningEffort!.default).toBe('low');
	});

	it('falls back to the strongest tier when the default is unavailable', () => {
		// Pro has no medium; defaulting to it would show a value the model cannot serve.
		expect(buildConfigurationSchema(pro, 1_000_000, 'medium')!.properties.reasoningEffort!.default).toBe('high');
	});

	it('emits no schema for a model with nothing to configure', () => {
		expect(buildConfigurationSchema(spec('gpt-oss-120b-medium', 'x'), 100_000, 'high')).toBeUndefined();
	});
});

describe('effortFromModelOptions', () => {
	it('takes the picker selection over the fallback', () => {
		expect(effortFromModelOptions({ reasoningEffort: 'high' }, 'low')).toBe('high');
	});

	it('uses the fallback when nothing was selected', () => {
		expect(effortFromModelOptions(undefined, 'medium')).toBe('medium');
		expect(effortFromModelOptions({}, 'medium')).toBe('medium');
	});

	it('ignores a value that is not a known effort', () => {
		expect(effortFromModelOptions({ reasoningEffort: 'turbo' }, 'low')).toBe('low');
		expect(effortFromModelOptions({ reasoningEffort: 3 }, 'low')).toBe('low');
	});
});
