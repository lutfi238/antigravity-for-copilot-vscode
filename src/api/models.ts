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
	/**
	 * Set on a collapsed entry: the sibling model ids for each effort tier, so the
	 * request can pick one without the picker carrying a row per tier.
	 */
	tierVariants?: Partial<Record<'low' | 'medium' | 'high', string>>;
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
	spec('gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'),
	spec('gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'),
	spec('gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'),
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

/** Antigravity lists no Gemini older than 3, so neither do we. */
const MIN_GEMINI_GENERATION = 3;

/** How many generations of a line Antigravity keeps on offer at once. */
const GENERATION_WINDOW = 3;

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

	// Match Antigravity's published model list without hardcoding it, because that list
	// moves: it showed 3.5/3.6/3.7 Flash, then 3.6/3.7/3.8 when 3.8 landed. The shape
	// that held across both is a rolling window — the newest few generations of each
	// line, with the oldest retiring as a new one arrives. Encoding the window rather
	// than the members means a new generation appears and an obsolete one leaves on
	// their own.
	const eligible = deduped.filter((model) => {
		const parsed = parseGeminiLine(model.id, model.name);
		// Claude and GPT-OSS have no generation ladder and are always offered.
		if (!parsed) {
			return true;
		}
		// Flash Lite is a line of its own that Antigravity never presents as a choice.
		return parsed.line !== 'flash-lite' && parsed.version >= MIN_GEMINI_GENERATION;
	});

	// Per line, keep only the newest few versions.
	const kept = new Map<string, Set<number>>();
	for (const model of eligible) {
		const parsed = parseGeminiLine(model.id, model.name);
		if (!parsed) {
			continue;
		}
		const versions = kept.get(parsed.line) ?? new Set<number>();
		versions.add(parsed.version);
		kept.set(parsed.line, versions);
	}
	for (const [line, versions] of kept) {
		const newest = [...versions].sort((a, b) => b - a).slice(0, GENERATION_WINDOW);
		kept.set(line, new Set(newest));
	}

	return eligible.filter((model) => {
		const parsed = parseGeminiLine(model.id, model.name);
		return !parsed || kept.get(parsed.line)?.has(parsed.version) === true;
	});
}

/** Strips a trailing "(High)" / "(Medium)" / "(Low)" from a display name. */
function baseName(name: string): string {
	return name.replace(/\s*\((?:high|medium|low|minimal|extra[\s-]?low)\)\s*$/i, '').trim();
}

/**
 * Folds a model's effort tiers into a single picker entry.
 *
 * Antigravity addresses each effort tier as its own model id, so discovery reports
 * "Gemini 3.7 Flash (High)" and "(Medium)" and "(Low)" as three models. Passing those
 * straight through triples the picker. Collapsing keeps one row and defers the tier to
 * request time — at the cost of the picker no longer being a per-request effort
 * switch, which is the only such control the VS Code provider API allows.
 */
export function collapseTiers(models: ModelSpec[]): ModelSpec[] {
	const groups = new Map<string, ModelSpec[]>();
	for (const model of models) {
		const key = baseName(model.name);
		const list = groups.get(key);
		if (list) {
			list.push(model);
		} else {
			groups.set(key, [model]);
		}
	}

	const out: ModelSpec[] = [];
	for (const [base, group] of groups) {
		const tiered = group.filter((model) => model.thinkingTier);
		if (tiered.length < 2) {
			out.push(...group);
			continue;
		}

		const tierVariants: NonNullable<ModelSpec['tierVariants']> = {};
		for (const model of tiered) {
			// First id wins per tier, matching discovery order.
			const tier = model.thinkingTier!;
			tierVariants[tier] = tierVariants[tier] ?? model.id;
		}

		// Represent the group with its strongest tier so an unset effort is not a downgrade.
		const preferred =
			tiered.find((model) => model.thinkingTier === 'high') ??
			tiered.find((model) => model.thinkingTier === 'medium') ??
			tiered[0];

		out.push({ ...preferred, name: base, tierVariants });
		out.push(...group.filter((model) => !model.thinkingTier));
	}
	return out;
}

/** Picks the sibling id matching the requested effort, if the entry is collapsed. */
export function resolveTier(model: ModelSpec, effort: 'off' | 'low' | 'medium' | 'high'): string {
	if (!model.tierVariants) {
		return model.id;
	}
	const wanted: 'low' | 'medium' | 'high' = effort === 'off' ? 'low' : effort;
	const order: Array<'low' | 'medium' | 'high'> = wanted === 'high' ? ['high', 'medium', 'low'] : wanted === 'medium' ? ['medium', 'high', 'low'] : ['low', 'medium', 'high'];
	for (const tier of order) {
		const id = model.tierVariants[tier];
		if (id) {
			return id;
		}
	}
	return model.id;
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

	// The gateway does not report limits, so they come from the family — and Gemini Pro
	// caps output one token below Flash. Sending Flash's 65536 to Pro is rejected as
	// INVALID_ARGUMENT with no field named, which is unusually hard to trace back.
	const limits =
		family === 'claude'
			? { context: 250_000, output: 64_000 }
			: family === 'gpt-oss'
				? { context: 131_072, output: 32_768 }
				: lower.includes('image')
					? { context: 66_000, output: 33_000 }
					: lower.includes('flash')
						? { context: 1_048_576, output: 65_536 }
						: { context: 1_048_576, output: 65_535 };

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
