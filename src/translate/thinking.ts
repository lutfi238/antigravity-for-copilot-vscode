import { ModelSpec } from '../api/models';
import { GeminiGenerationConfig } from './types';

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

const BUDGETS: Record<Exclude<ReasoningEffort, 'off'>, number> = {
	low: 8_192,
	medium: 16_384,
	high: 32_768,
	// Only reached if a budget model is asked for xhigh; tiered models carry it in the id.
	xhigh: 32_768,
};

/**
 * Builds `thinkingConfig` for the models that take one.
 *
 * Tiered Gemini chat models use the resolved model id and, when requesting
 * thoughts, a matching `thinkingLevel` string. Only numeric-budget models receive
 * `thinkingBudget`.
 *
 * For the models that do take a budget, the gateway's one hard rule applies:
 * `maxOutputTokens` must be strictly greater than `thinkingBudget`.
 */
export function applyThinking(
	config: GeminiGenerationConfig,
	model: ModelSpec,
	effort: ReasoningEffort,
	includeThoughts: boolean,
): GeminiGenerationConfig {
	if (model.thinkingStyle === 'model-id-tier') {
		// The tier normally comes from the resolved model id. A discovered route that
		// publishes no tier — `gemini-4-hydrogen-sonar` is the live example — would
		// otherwise send no `thinkingLevel` at all, silently discarding the effort the
		// user chose in the picker. Fall back to the requested effort so the choice
		// reaches the wire instead of only appearing in the log.
		//
		// `fixedEffort` entries must not take that fallback: Orchestrator runs a fixed
		// configuration and its id publishes no tier either, so without this guard it
		// would silently receive the global default level — the exact wire change the
		// picker withholds a control for.
		const level = model.thinkingTier ?? (model.fixedEffort || effort === 'off' ? undefined : effort);

		// Visibility and control are separate concerns. A tier in the id survives on its
		// own — the id is the route — so hiding thoughts keeps the previous wire shape for
		// those models. A level the picker chose has no id to ride on, and dropping it here
		// would make `showThinking=false` silently disable the Sonar effort that the picker
		// still offers. Only the thoughts are withheld, never the choice.
		if (!includeThoughts) {
			const picked = model.thinkingTier ? undefined : level;
			return picked ? { ...config, thinkingConfig: { thinkingLevel: picked } } : config;
		}
		return {
			...config,
			thinkingConfig: {
				includeThoughts: true,
				...(level ? { thinkingLevel: level } : {}),
			},
		};
	}

	if (model.thinkingStyle !== 'numeric-budget' || effort === 'off') {
		return config;
	}

	const maxOutput = config.maxOutputTokens ?? model.maxOutputTokens;
	// Leave headroom so the answer itself has somewhere to go.
	const ceiling = Math.max(1024, Math.floor(maxOutput / 2));
	const budget = Math.min(BUDGETS[effort], ceiling);

	if (budget >= maxOutput) {
		return config;
	}

	return {
		...config,
		maxOutputTokens: maxOutput,
		thinkingConfig: { thinkingBudget: budget, includeThoughts },
	};
}

/**
 * Gemini 3 hands back a `thoughtSignature` on the parts it produces and expects to see
 * it again when that turn is replayed. VS Code's message history has no field to carry
 * it, so we cache it here, keyed by the tool-call id that travels with the turn.
 *
 * Without this, multi-turn tool-using conversations fail on the second turn.
 */
export class SignatureCache {
	private readonly entries = new Map<string, string>();
	private readonly limit = 500;

	set(key: string, signature: string): void {
		if (this.entries.has(key)) {
			this.entries.delete(key);
		}
		this.entries.set(key, signature);
		if (this.entries.size > this.limit) {
			// Map preserves insertion order, so the first key is the oldest.
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
			}
		}
	}

	get(key: string): string | undefined {
		return this.entries.get(key);
	}
}

/** Stable key for a piece of assistant text, used when there is no tool-call id. */
export function textKey(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
	}
	return `text:${(hash >>> 0).toString(36)}:${text.length}`;
}
