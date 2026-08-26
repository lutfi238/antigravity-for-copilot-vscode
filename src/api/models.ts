import { GatewayClient } from './client';
import { DISCOVERY_ENDPOINTS } from './constants';
import { log } from '../log';

export type Family = 'gemini' | 'claude' | 'gpt-oss';

/** Quota is metered in three separate pools, not two: Flash refills far faster than Pro. */
export type QuotaGroup = 'gemini-pro' | 'gemini-flash' | 'claude';

export interface ModelSpec {
	id: string;
	name: string;
	family: Family;
	contextWindow: number;
	maxOutputTokens: number;
	supportsImages: boolean;
	/**
	 * Gemini 3 takes its thinking level from the tier suffix in the model id
	 * (`-low`, `-high`, …), so no thinkingConfig is sent. Claude takes a numeric budget.
	 */
	thinkingStyle: 'none' | 'model-id-tier' | 'numeric-budget';
	/** Effort tier parsed out of the model id, for models that encode it there. */
	thinkingTier?: 'low' | 'medium' | 'high';
}

/**
 * Recovers the effort tier from a model id. `-agent` marks the top tier, and 3.5's
 * `-extra-low` is its lowest — neither follows the plain `-low`/`-medium`/`-high`
 * pattern the other generations use.
 */
export function tierOf(id: string): 'low' | 'medium' | 'high' | undefined {
	const lower = id.toLowerCase();
	if (lower.endsWith('-agent')) {
		return 'high';
	}
	if (lower.endsWith('-extra-low') || lower.endsWith('-minimal')) {
		return 'low';
	}
	const match = /-(low|medium|high)$/.exec(lower);
	return match ? (match[1] as 'low' | 'medium' | 'high') : undefined;
}

export interface QuotaBucket {
	/** 0–1, where 1 means untouched. Undefined when the gateway reports nothing. */
	remainingFraction?: number;
	/** ISO timestamp at which the bucket refills. */
	resetTime?: string;
	modelCount: number;
}

export interface Catalog {
	models: ModelSpec[];
	quota: Partial<Record<QuotaGroup, QuotaBucket>>;
	/** True when discovery failed and the hardcoded roster is standing in. */
	isFallback: boolean;
}

/**
 * The gateway returns a MAP keyed by model id, not an array. Getting this wrong yields
 * an empty catalogue and no quota, which looks identical to "the account has no access".
 */
interface FetchAvailableModelsResponse {
	models?: Record<string, FetchAvailableModelEntry>;
}

interface FetchAvailableModelEntry {
	quotaInfo?: { remainingFraction?: number; resetTime?: string };
	displayName?: string;
	modelName?: string;
}

/**
 * The live Antigravity roster, as wire ids.
 *
 * Two of these look wrong and are not: the top Gemini tiers are addressed as
 * `gemini-pro-agent` and `gemini-3-flash-agent` rather than a `-high` suffix, and
 * Gemini 3.5's three tiers are `-high` / `-low` / `-extra-low` where `-low` is
 * actually the middle one. Renaming them to look tidy would 404.
 */
export const FALLBACK_MODELS: ModelSpec[] = [
	spec('gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)'),
	spec('gemini-3.7-flash-medium', 'Gemini 3.7 Flash (Medium)'),
	spec('gemini-3.7-flash-low', 'Gemini 3.7 Flash (Low)'),
	spec('gemini-3.6-flash-high', 'Gemini 3.6 Flash (High)'),
	spec('gemini-3.6-flash-medium', 'Gemini 3.6 Flash (Medium)'),
	spec('gemini-3.6-flash-low', 'Gemini 3.6 Flash (Low)'),
	spec('gemini-3-flash-agent', 'Gemini 3.5 Flash (High)'),
	spec('gemini-3.5-flash-low', 'Gemini 3.5 Flash (Medium)'),
	spec('gemini-3.5-flash-extra-low', 'Gemini 3.5 Flash (Low)'),
	spec('gemini-pro-agent', 'Gemini 3.1 Pro (High)'),
	spec('gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)'),
	spec('claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'),
	spec('claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'),
	spec('gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)'),
];

export async function fetchCatalog(client: GatewayClient, op: string, project: string): Promise<Catalog> {
	let response: FetchAvailableModelsResponse;
	try {
		response = await client.postJson<FetchAvailableModelsResponse>({
			op,
			action: 'fetchAvailableModels',
			endpoints: DISCOVERY_ENDPOINTS,
			body: { project },
		});
	} catch (error) {
		// Loud, not silent: a stale picker with no quota is the visible symptom, and the
		// cause is only ever findable here.
		log.error(op, 'model discovery failed — falling back to the built-in roster', { error });
		return { models: FALLBACK_MODELS, quota: {}, isFallback: true };
	}

	const entries = Object.entries(response.models ?? {});
	if (entries.length === 0) {
		log.error(op, 'model discovery returned no models — falling back to the built-in roster', {
			keys: Object.keys(response ?? {}).join(','),
		});
		return { models: FALLBACK_MODELS, quota: {}, isFallback: true };
	}

	const models: ModelSpec[] = [];
	const quota: Catalog['quota'] = {};

	for (const [modelId, entry] of entries) {
		models.push(spec(modelId, entry.displayName || prettify(modelId)));

		const group = classify(modelId, entry.displayName ?? entry.modelName);
		if (group) {
			quota[group] = merge(quota[group], entry.quotaInfo);
		}
	}

	log.info(op, 'discovery complete', {
		models: models.length,
		buckets: Object.keys(quota).join(',') || 'none',
	});
	return { models, quota, isFallback: false };
}

/**
 * Model ids the gateway lists but that have no business in a chat picker:
 * `Tab_*` are inline-autocomplete models, `Chat_NNNNN` are internal numeric aliases
 * for models already listed under real names, `*tiered*` are server-side routing
 * aliases, and image models cannot answer a chat turn.
 */
const NON_CHAT = /^tab[_-]|^chat[_-]?\d+$|tiered|image/i;

interface GeminiLine {
	line: string;
	version: number;
}

/**
 * Works out which product line and generation a Gemini model belongs to.
 *
 * The display name is the more reliable source: several ids are irregular
 * (`gemini-3-flash-agent` is actually 3.5 Flash, `gemini-pro-agent` is 3.1 Pro), and
 * only the display name carries the true generation.
 */
function parseGeminiLine(id: string, name: string): GeminiLine | null {
	const text = `${name} ${id}`.toLowerCase();
	if (!text.includes('gemini')) {
		return null;
	}

	const line = /flash[\s-]?lite/.test(text)
		? 'flash-lite'
		: /flash/.test(text)
			? 'flash'
			: /pro/.test(text)
				? 'pro'
				: null;
	if (!line) {
		return null;
	}

	const match = /gemini[\s-]*(\d+(?:\.\d+)?)/.exec(name.toLowerCase()) ?? /gemini[\s-]*(\d+(?:\.\d+)?)/.exec(id);
	return match ? { line, version: Number(match[1]) } : null;
}

/**
 * Trims the raw catalogue down to what is actually worth offering.
 *
 * Discovery returns every model the backend can route to, including several
 * generations of the same line, exact duplicates under one display name, and internal
 * aliases. Showing all of it makes the picker unusable — if 3.7 Flash is available,
 * 3.5 and 3.6 Flash are just noise.
 */
export function curateModels(models: ModelSpec[], keepAllGenerations: boolean): ModelSpec[] {
	const chatModels = models.filter((model) => !NON_CHAT.test(model.id) && !NON_CHAT.test(model.name));

	// Exact display-name duplicates are common (four separate ids all render as
	// "Gemini 3.1 Flash Lite"); the picker cannot distinguish them, so keep the first.
	const seen = new Set<string>();
	const deduped = chatModels.filter((model) => {
		const key = model.name.toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});

	if (keepAllGenerations) {
		return deduped;
	}

	// Keep only the newest generation of each Gemini line; all its tiers survive.
	const newest = new Map<string, number>();
	for (const model of deduped) {
		const parsed = parseGeminiLine(model.id, model.name);
		if (parsed) {
			newest.set(parsed.line, Math.max(newest.get(parsed.line) ?? 0, parsed.version));
		}
	}

	return deduped.filter((model) => {
		const parsed = parseGeminiLine(model.id, model.name);
		// Non-Gemini models (Claude, GPT-OSS) have no generation ladder to prune.
		return !parsed || parsed.version === newest.get(parsed.line);
	});
}

function classify(modelId: string, displayName?: string): QuotaGroup | null {
	const combined = `${modelId} ${displayName ?? ''}`.toLowerCase();
	if (combined.includes('claude') || combined.includes('gpt')) {
		return 'claude';
	}
	if (!combined.includes('gemini')) {
		return null;
	}
	return combined.includes('flash') ? 'gemini-flash' : 'gemini-pro';
}

/** Keeps the tightest constraint across the models sharing a bucket. */
function merge(existing: QuotaBucket | undefined, info: FetchAvailableModelEntry['quotaInfo']): QuotaBucket {
	const modelCount = (existing?.modelCount ?? 0) + 1;
	if (!info) {
		return { ...existing, modelCount };
	}

	const incoming = clamp(info.remainingFraction);
	const remainingFraction =
		incoming === undefined
			? existing?.remainingFraction
			: existing?.remainingFraction === undefined
				? incoming
				: Math.min(existing.remainingFraction, incoming);

	let resetTime = existing?.resetTime;
	if (info.resetTime) {
		const nextAt = Date.parse(info.resetTime);
		const currentAt = resetTime ? Date.parse(resetTime) : Number.NaN;
		if (!Number.isNaN(nextAt) && (Number.isNaN(currentAt) || nextAt < currentAt)) {
			resetTime = info.resetTime;
		}
	}

	return { remainingFraction, resetTime, modelCount };
}

function clamp(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	return Math.min(1, Math.max(0, value));
}

export function familyOf(modelId: string): Family {
	const lower = modelId.toLowerCase();
	if (lower.includes('claude')) {
		return 'claude';
	}
	if (lower.startsWith('gpt')) {
		return 'gpt-oss';
	}
	return 'gemini';
}

export function spec(id: string, name: string): ModelSpec {
	const family = familyOf(id);
	const lower = id.toLowerCase();

	// The gateway does not report limits, so they come from the family.
	const limits =
		family === 'claude'
			? { context: 250_000, output: 64_000 }
			: family === 'gpt-oss'
				? { context: 131_072, output: 32_768 }
				: lower.includes('image')
					? { context: 66_000, output: 33_000 }
					: { context: 1_048_576, output: 65_536 };

	// Every current Gemini model selects its thinking level from the tier baked into
	// the id; only Claude takes an explicit numeric budget.
	const isGeminiReasoning = family === 'gemini' && !lower.includes('image');

	return {
		id,
		name,
		family,
		contextWindow: limits.context,
		maxOutputTokens: limits.output,
		supportsImages: family === 'gemini' || family === 'claude',
		thinkingStyle: isGeminiReasoning
			? 'model-id-tier'
			: family === 'claude'
				? 'numeric-budget'
				: 'none',
		thinkingTier: tierOf(id),
	};
}

function prettify(id: string): string {
	return id
		.split('-')
		.map((part) => (part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
		.join(' ');
}
