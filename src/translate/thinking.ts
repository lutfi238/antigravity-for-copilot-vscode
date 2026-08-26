import { ModelSpec } from '../api/models';
import { GeminiGenerationConfig } from './types';

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

const BUDGETS: Record<Exclude<ReasoningEffort, 'off'>, number> = {
	low: 8_192,
	medium: 16_384,
	high: 32_768,
};

/**
 * Builds `thinkingConfig` for the models that take one.
 *
 * Gemini 3 is deliberately excluded: it selects its thinking level from the tier
 * suffix already baked into the model id (`gemini-3.1-pro-high`), and takes a
 * `thinkingLevel` string rather than a numeric budget. Sending a budget to it is at
 * best ignored and at worst a 400.
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
		// The tier in the model id already selects the effort, so the only reason to
		// send a config at all is to ask for the thoughts back. Staying off this path
		// by default keeps the known-good request shape untouched.
		if (!includeThoughts) {
			return config;
		}
		return {
			...config,
			thinkingConfig: {
				includeThoughts: true,
				...(model.thinkingTier ? { thinkingLevel: model.thinkingTier } : {}),
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
