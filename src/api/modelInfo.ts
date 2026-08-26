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

/**
 * Every place VS Code might hand back a model-picker selection.
 *
 * `modelConfiguration` and `configuration` are undeclared in `@types/vscode` but are
 * where the `configurationSchema` values actually arrive — `modelOptions` carries only
 * VS Code's own internal keys (`_conversationId`, `_enableThinking`, …). Reading just
 * `modelOptions` silently loses the user's choice and falls back to the setting.
 */
export interface EffortSources {
	readonly modelOptions?: Record<string, unknown>;
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
}

export type EffortSource =
	| 'modelOptions'
	| 'modelConfiguration'
	| 'configuration'
	| 'setting';

function asEffort(value: unknown): Effort | undefined {
	return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

/** Pulls an effort out of a bag, tolerating the several shapes it has been seen in. */
function fromBag(bag: Record<string, unknown> | undefined): Effort | undefined {
	if (!bag) {
		return undefined;
	}
	const nested = (key: string): unknown => {
		const inner = bag[key];
		return inner && typeof inner === 'object' ? (inner as Record<string, unknown>).effort : undefined;
	};
	return (
		asEffort(bag.reasoningEffort) ??
		asEffort(bag.thinkingEffort) ??
		asEffort(nested('reasoning')) ??
		asEffort(nested('thinking')) ??
		asEffort(bag.thinking)
	);
}

export function resolveEffort(
	sources: EffortSources,
	fallback: Effort,
): { effort: Effort; source: EffortSource } {
	const ordered: Array<[EffortSource, Record<string, unknown> | undefined]> = [
		['modelConfiguration', sources.modelConfiguration],
		['modelOptions', sources.modelOptions],
		['configuration', sources.configuration],
	];
	for (const [source, bag] of ordered) {
		const effort = fromBag(bag);
		if (effort) {
			return { effort, source };
		}
	}
	return { effort: fallback, source: 'setting' };
}
