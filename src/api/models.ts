import { GatewayClient } from './client';
import { DISCOVERY_ENDPOINTS } from './constants';
import { log } from '../log';
import { Account } from '../auth/store';

export type Family = 'gemini' | 'claude' | 'gpt-oss';

/** Display standard Gemini, discovered Gemini Argon, and Claude/GPT separately. */
export type QuotaGroup = 'gemini' | 'argon' | 'claude';

/**
 * Effort tiers Antigravity addresses as separate model ids.
 *
 * `xhigh` is published by Gemini 4 Hydrogen. The CLI also understands `max`, but no
 * discovered model id encodes it yet, so it is not offered here.
 */
export type ThinkingTier = 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelSpec {
	id: string;
	name: string;
	family: Family;
	contextWindow: number;
	maxOutputTokens: number;
	supportsImages: boolean;
	/**
	 * Gemini chat models select effort from the model id. When thoughts are requested,
	 * thinkingConfig repeats the resolved tier. Claude takes a numeric budget.
	 */
	thinkingStyle: 'none' | 'model-id-tier' | 'numeric-budget';
	/** Effort tier parsed out of the model id, for models that encode it there. */
	thinkingTier?: ThinkingTier;
	/**
	 * Set on a collapsed entry: the sibling model ids for each effort tier, so the
	 * request can pick one without the picker carrying a row per tier.
	 */
	tierVariants?: Partial<Record<ThinkingTier, string>>;
	/**
	 * True when the backend runs this entry with a fixed configuration and ignores effort.
	 * Orchestrator is the documented case: it pairs a planner with Hydrogen and exposes no
	 * thinking level, so offering a control would promise something it cannot honor.
	 */
	fixedEffort?: boolean;
}

/**
 * Recovers the effort tier from a model id. `-agent` marks the top tier, `-xhigh`
 * marks extra-high (Gemini 4 Hydrogen), and 3.5's `-extra-low` is its lowest — none
 * of those follow the plain `-low`/`-medium`/`-high` suffix pattern.
 */
export function tierOf(id: string): ThinkingTier | undefined {
	const lower = id.toLowerCase();
	if (lower.endsWith('-agent')) {
		return 'high';
	}
	if (lower.endsWith('-xhigh') || lower.endsWith('-extra-high')) {
		return 'xhigh';
	}
	if (lower.endsWith('-extra-low') || lower.endsWith('-minimal')) {
		return 'low';
	}
	const match = /-(low|medium|high)$/.exec(lower);
	return match ? (match[1] as ThinkingTier) : undefined;
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
	/** Plan placeholders the backend lists but will not route a turn to. */
	disabled?: boolean;
}

/**
 * Conservative fallback snapshot verified with `agy models` on 2026-10-14.
 * Used only when discovery fails or returns an empty model map, never merged into
 * a successful catalogue. Do not add plan-gated previews or guessed model ids.
 */
export const FALLBACK_MODELS: ModelSpec[] = [
	spec('gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'),
	spec('gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'),
	spec('gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'),
	spec('claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'),
	spec('claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'),
	spec('gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)'),
];

export async function fetchCatalog(client: GatewayClient, op: string, project: string, account?: Account): Promise<Catalog> {
	let response: FetchAvailableModelsResponse;
	try {
		response = await client.postJson<FetchAvailableModelsResponse>({
			op,
			action: 'fetchAvailableModels',
			endpoints: DISCOVERY_ENDPOINTS,
			body: { project },
			...(account ? { account } : {}),
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
		if (entry.disabled === true) {
			continue;
		}
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
	logRoster(op, entries);
	logTierless(op, models);
	return { models, quota, isFallback: false };
}

/**
 * Names the Gemini entries that publish no effort tier.
 *
 * These are the only rows that can reach the picker without a Thinking Effort control,
 * so they are the ones worth naming. Split across lines for the same reason as the
 * roster: `log` renders any string over 200 characters as `<N chars>`, which would turn
 * this list into a character count and defeat the diagnostic.
 */
function logTierless(op: string, models: ModelSpec[]): void {
	const ids = tierlessLineIds(models);
	if (ids.length === 0) {
		log.info(op, 'discovery tierless', { ids: 'none' });
		return;
	}
	let current = '';
	let part = 1;
	const flush = () => {
		if (current) {
			log.info(op, 'discovery tierless', { part, ids: current });
			part++;
			current = '';
		}
	};
	for (const id of ids) {
		const next = current ? `${current},${id}` : id;
		if (next.length > 180 && current) {
			flush();
			current = id;
		} else {
			current = next;
		}
	}
	flush();
}

/**
 * Records the raw gateway roster, split across lines.
 *
 * Curation drops entries for reasons that are not reconstructable afterwards, so a
 * picker row missing its Thinking Effort control is otherwise indistinguishable from a
 * model that never had tiers. The split is not cosmetic: `log` renders any string over
 * 200 characters as `<N chars>`, which would erase a twenty-model join entirely.
 *
 * `(unnamed)` means the gateway reported no usable `displayName` for that entry, so the
 * picker fell back to `prettify(id)`. It does NOT mean the name was absent on the wire:
 * a `displayName` that happens to equal `prettify(id)` produces the same picker text, and
 * nothing in the discovery response distinguishes the two. The marker states exactly what
 * this code observed. `(disabled)` marks a plan placeholder the backend will not route.
 * Ids and markers only — never prompts or account identifiers.
 */
function logRoster(op: string, entries: Array<[string, FetchAvailableModelEntry]>): void {
	const LIMIT = 180;
	const chunks: string[] = [];
	let current = '';
	for (const [id, entry] of entries) {
		const marker = entry.disabled === true ? '(disabled)' : !entry.displayName ? '(unnamed)' : '';
		const token = `${id}${marker}`;
		const next = current ? `${current},${token}` : token;
		if (next.length > LIMIT && current) {
			chunks.push(current);
			current = token;
		} else {
			current = next;
		}
	}
	if (current) {
		chunks.push(current);
	}
	chunks.forEach((ids, index) => {
		log.info(op, 'discovery roster', { part: `${index + 1}/${chunks.length}`, ids });
	});
}

/**
 * Model ids the gateway lists but that have no business in a chat picker:
 * `Tab_*` are inline-autocomplete models, `Chat_NNNNN` are internal numeric aliases
 * for models already listed under real names, `*tiered*` and `*-worker-*` are
 * server-side routing/subagent aliases, `*-disabled` entries are plan placeholders
 * the backend will not route, and image models cannot answer a chat turn.
 *
 * Deliberately NOT listed: `gemini-4-hydrogen-sonar`. This account generated with it on
 * 2026-11-17 (see the `chat request` lines), so it routes — discarding it would remove a
 * working model. Its id publishes no effort tier, which is why it reaches the picker
 * without a Thinking Effort control. Whether the gateway also returns tiered Hydrogen
 * siblings is what `discovery roster` exists to establish; do not assume either way.
 */
const NON_CHAT = /^tab[_-]|^chat[_-]?\d+$|tiered|image|(?:^|[_-])(?:worker|disabled)(?:[_-]|$)/i;

/** Gemini entries in a tiered product line that publish no effort tier. */
function tierlessLineIds(models: ModelSpec[]): string[] {
	return models
		.filter((model) => model.family === 'gemini' && !model.thinkingTier)
		.filter((model) => parseGeminiLine(model.id, model.name) !== null)
		.map((model) => model.id);
}

/** Compatibility filter for older catalogues; not a promise about today's native list. */
const MIN_GEMINI_GENERATION = 3;

/** Maximum discovered generations per product line in the bridge's curated view. */
const GENERATION_WINDOW = 1;

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
			: /orchestrator/.test(text)
				? 'orchestrator'
				: /pro/.test(text)
					? 'pro'
					: /argon/.test(text)
						? 'argon'
						: /hydrogen/.test(text)
							? 'hydrogen'
							: /carbon/.test(text)
								? 'carbon'
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
	// Effort siblings are the exception: when discovery sends a bare name for every tier
	// ("Gemini 4 Hydrogen" for all of high/medium/low/xhigh), the name alone is not a
	// duplicate key. Include the tier, or curation discards the variants before
	// collapseTiers can fold them into one entry with a Thinking Effort control.
	const seen = new Set<string>();
	const deduped = chatModels.filter((model) => {
		const key = `${baseName(model.name).toLowerCase()}|${model.thinkingTier ?? ''}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});

	if (keepAllGenerations) {
		return deduped;
	}

	// Limit older multi-generation catalogues without manufacturing missing models.
	// A successful current catalogue can contain just one Flash generation. Unknown
	// Gemini product lines pass through so newly discovered chat models can appear.
	const eligible = deduped.filter((model) => {
		const parsed = parseGeminiLine(model.id, model.name);
		// Claude and GPT-OSS have no generation ladder and are always offered.
		if (!parsed) {
			return true;
		}
		// Flash Lite is a line of its own that Antigravity never presents as a choice.
		return parsed.line !== 'flash-lite' && parsed.version >= MIN_GEMINI_GENERATION;
	});

	// Per line, keep only the newest discovered version and all of its effort tiers.
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

/** Strips a trailing "(XHigh)" / "(High)" / "(Medium)" / "(Low)" from a display name. */
function baseName(name: string): string {
	return name
		.replace(/\s*\((?:xhigh|extra[\s-]?high|high|medium|low|minimal|extra[\s-]?low)\)\s*$/i, '')
		.trim();
}

/**
 * Folds a model's effort tiers into a single picker entry.
 *
 * Antigravity addresses each effort tier as its own model id, so discovery reports
 * "Gemini 3.7 Flash (High)" and "(Medium)" and "(Low)" as three models. Passing those
 * straight through triples the picker. Collapsing keeps one row and defers the tier to
 * request time. The provider exposes the available variants through the picker's
 * per-request Thinking Effort configuration.
 */
export function collapseTiers(models: ModelSpec[]): ModelSpec[] {
	// Group by display name with any trailing tier label removed. When discovery sends a
	// bare name for every tier, that label is absent and the name still groups them.
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
		// The tier normally comes from the id (via `spec`). A bare-name payload gives every
		// sibling the same name, so fall back to the id suffix here as well: otherwise the
		// group looks untiered and the picker silently loses its Thinking Effort control.
		const tiered = group.map((model) => ({
			model,
			tier: model.thinkingTier ?? tierOf(model.id),
		}));
		const withTier = tiered.filter((entry) => entry.tier);
		if (withTier.length < 2) {
			out.push(...group);
			continue;
		}

		const tierVariants: NonNullable<ModelSpec['tierVariants']> = {};
		for (const { model, tier } of withTier) {
			// First id wins per tier, matching discovery order.
			tierVariants[tier!] = tierVariants[tier!] ?? model.id;
		}

		// Represent the group with its strongest standard tier so an unset effort is not a
		// downgrade. `high` outranks `xhigh` deliberately: the group is addressed by its
		// representative id, and `high` is the tier every generation publishes.
		const preferred =
			withTier.find((entry) => entry.tier === 'high') ??
			withTier.find((entry) => entry.tier === 'xhigh') ??
			withTier.find((entry) => entry.tier === 'medium') ??
			withTier[0];

		// Carry the resolved tier on the representative so translation and the picker agree.
		out.push({ ...preferred.model, thinkingTier: preferred.tier!, name: base, tierVariants });
		out.push(...tiered.filter((entry) => !entry.tier).map((entry) => entry.model));
	}
	return out;
}

/** Picks the sibling id matching the requested effort, if the entry is collapsed. */
export function resolveTier(model: ModelSpec, effort: 'off' | ThinkingTier): string {
	if (!model.tierVariants) {
		return model.id;
	}
	const wanted: ThinkingTier = effort === 'off' ? 'low' : effort;
	const order: ThinkingTier[] =
		wanted === 'xhigh'
			? ['xhigh', 'high', 'medium', 'low']
			: wanted === 'high'
				? ['high', 'xhigh', 'medium', 'low']
				: wanted === 'medium'
					? ['medium', 'high', 'xhigh', 'low']
					: ['low', 'medium', 'high', 'xhigh'];
	for (const tier of order) {
		const id = model.tierVariants[tier];
		if (id) {
			return id;
		}
	}
	return model.id;
}

/** Keep translation aligned with the resolved wire id, including missing-tier fallback. */
export function resolveTierSpec(model: ModelSpec, effort: 'off' | ThinkingTier): ModelSpec {
	const id = resolveTier(model, effort);
	return id === model.id ? model : { ...model, id, thinkingTier: tierOf(id) };
}

function classify(modelId: string, displayName?: string): QuotaGroup | null {
	const combined = `${modelId} ${displayName ?? ''}`.toLowerCase();
	if (combined.includes('claude') || combined.includes('gpt')) {
		return 'claude';
	}
	if (!combined.includes('gemini')) {
		return null;
	}
	return combined.includes('argon') ? 'argon' : 'gemini';
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
	const combined = `${lower} ${name.toLowerCase()}`;

	// The gateway does not report limits, so they come from the family — and Gemini Pro
	// caps output one token below Flash and Argon's documented synchronous limit.
	// Sending Flash's 65536 to Pro is rejected as
	// INVALID_ARGUMENT with no field named, which is unusually hard to trace back.
	const limits =
		family === 'claude'
			? { context: 250_000, output: 64_000 }
			: family === 'gpt-oss'
				? { context: 131_072, output: 32_768 }
				: lower.includes('image')
					? { context: 66_000, output: 33_000 }
					: lower.includes('flash') ||
						  combined.includes('argon') ||
						  combined.includes('hydrogen') ||
						  combined.includes('carbon') ||
						  combined.includes('orchestrator')
						? { context: 1_048_576, output: 65_536 }
						: { context: 1_048_576, output: 65_535 };

	// Every current Gemini model selects its thinking level from the tier baked into
	// the id; only Claude takes an explicit numeric budget.
	const isGeminiReasoning = family === 'gemini' && !lower.includes('image');
	// Orchestrator runs a fixed configuration, so it publishes no effort to choose.
	const fixedEffort = family === 'gemini' && combined.includes('orchestrator');

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
		...(fixedEffort ? { fixedEffort: true } : {}),
	};
}

function prettify(id: string): string {
	return id
		.split('-')
		.map((part) => (part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
		.join(' ');
}
