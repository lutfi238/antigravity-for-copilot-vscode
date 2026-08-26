import * as vscode from 'vscode';
import { ModelSpec } from './models';

export type Effort = 'low' | 'medium' | 'high';

/**
 * Per-model controls rendered beside the model in the picker.
 *
 * `configurationSchema` is **not** declared in `@types/vscode`, but the VS Code runtime
 * honours it — it is how a provider gets the effort/context dropdowns that Copilot's
 * own models show. The selected values come back as `modelOptions` on the next request.
 * Because the field is undeclared, the information object is widened locally rather
 * than cast at the call site.
 */
export interface ModelConfigurationSchema {
	readonly properties: {
		reasoningEffort?: {
			readonly type: 'string';
			readonly title: string;
			readonly enum: readonly Effort[];
			readonly enumItemLabels: readonly string[];
			readonly enumDescriptions: readonly string[];
			readonly default: Effort;
			readonly group: 'navigation';
		};
		contextSize?: {
			readonly type: 'number';
			readonly title: string;
			readonly enum: readonly number[];
			readonly enumItemLabels: readonly string[];
			readonly enumDescriptions: readonly string[];
			readonly default: number;
			readonly group: 'tokens';
		};
	};
}

export type ProviderChatInformation = vscode.LanguageModelChatInformation & {
	readonly configurationSchema?: ModelConfigurationSchema;
};

const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high'];

const EFFORT_LABEL: Record<Effort, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
};

const EFFORT_DESCRIPTION: Record<Effort, string> = {
	low: 'Fastest and cheapest. Least thinking before answering.',
	medium: 'Balanced thinking for everyday work.',
	high: 'Most thinking. Best for hard reasoning, slowest and most quota.',
};

/**
 * Which efforts a model can actually serve.
 *
 * A collapsed Gemini entry can only offer the tiers the backend published as sibling
 * model ids — inventing a "medium" the gateway does not route would 404. Claude takes an
 * arbitrary numeric budget, so all three are genuine.
 */
export function availableEfforts(model: ModelSpec): Effort[] {
	if (model.tierVariants) {
		return EFFORT_ORDER.filter((effort) => model.tierVariants![effort]);
	}
	if (model.thinkingStyle === 'numeric-budget') {
		return [...EFFORT_ORDER];
	}
	return [];
}

export function buildConfigurationSchema(
	model: ModelSpec,
	_maxInputTokens: number,
	defaultEffort: Effort,
): ModelConfigurationSchema | undefined {
	const properties: {
		reasoningEffort?: ModelConfigurationSchema['properties']['reasoningEffort'];
		contextSize?: ModelConfigurationSchema['properties']['contextSize'];
	} = {};

	const efforts = availableEfforts(model);
	if (efforts.length > 1) {
		properties.reasoningEffort = {
			type: 'string',
			title: 'Thinking Effort',
			enum: efforts,
			enumItemLabels: efforts.map((effort) => EFFORT_LABEL[effort]),
			enumDescriptions: efforts.map((effort) => EFFORT_DESCRIPTION[effort]),
			// Start on the user's configured preference, but only if this model serves it.
			default: efforts.includes(defaultEffort) ? defaultEffort : efforts[efforts.length - 1],
			group: 'navigation',
		};
	}

	return properties.reasoningEffort ? { properties } : undefined;
}

/** Reads the effort the user picked in the model picker, if any. */
export function effortFromModelOptions(
	modelOptions: Record<string, unknown> | undefined,
	fallback: Effort,
): Effort {
	const chosen = modelOptions?.reasoningEffort;
	return chosen === 'low' || chosen === 'medium' || chosen === 'high' ? chosen : fallback;
}

