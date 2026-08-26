import { describe, expect, it } from 'vitest';
import { availableEfforts, buildConfigurationSchema, resolveEffort } from '../src/api/modelInfo';
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

describe('resolveEffort', () => {
	it('reads modelConfiguration, which is where the picker selection actually lands', () => {
		// modelOptions carries only VS Code's internal keys; reading just that loses the
		// user's choice and silently falls back to the setting.
		expect(
			resolveEffort({ modelConfiguration: { reasoningEffort: 'high' } }, 'medium'),
		).toEqual({ effort: 'high', source: 'modelConfiguration' });
	});

	it('ignores VS Code internal keys sitting alongside in modelOptions', () => {
		const result = resolveEffort(
			{
				modelOptions: { _conversationId: 'x', _enableThinking: true, _telemetryTurn: 1 },
				modelConfiguration: { reasoningEffort: 'low' },
			},
			'medium',
		);
		expect(result).toEqual({ effort: 'low', source: 'modelConfiguration' });
	});

	it('still honours modelOptions when the value arrives there', () => {
		expect(resolveEffort({ modelOptions: { reasoningEffort: 'high' } }, 'medium').source).toBe(
			'modelOptions',
		);
	});

	it('falls back to configuration as the last channel', () => {
		expect(resolveEffort({ configuration: { reasoningEffort: 'high' } }, 'low')).toEqual({
			effort: 'high',
			source: 'configuration',
		});
	});

	it('accepts the alternate shapes the value has been seen in', () => {
		expect(resolveEffort({ modelConfiguration: { thinkingEffort: 'high' } }, 'low').effort).toBe('high');
		expect(resolveEffort({ modelConfiguration: { reasoning: { effort: 'high' } } }, 'low').effort).toBe('high');
		expect(resolveEffort({ modelConfiguration: { thinking: { effort: 'low' } } }, 'high').effort).toBe('low');
	});

	it('falls back to the setting when no channel carries one', () => {
		expect(resolveEffort({}, 'medium')).toEqual({ effort: 'medium', source: 'setting' });
		expect(resolveEffort({ modelOptions: { _conversationId: 'x' } }, 'high').source).toBe('setting');
	});

	it('ignores values that are not a known effort', () => {
		expect(resolveEffort({ modelConfiguration: { reasoningEffort: 'turbo' } }, 'low').effort).toBe('low');
		expect(resolveEffort({ modelConfiguration: { reasoningEffort: 7 } }, 'low').source).toBe('setting');
	});
});
