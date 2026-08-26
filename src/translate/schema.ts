/**
 * The gateway validates tool schemas with strict protobuf rules that reject most of
 * what VS Code and MCP servers actually emit. Everything in this file exists to make
 * a real-world JSON Schema survive that validator.
 */

/**
 * Which validator the schema has to satisfy.
 *
 * The gateway speaks Gemini's wire format for every model, but it does not validate
 * tool schemas itself for every model. Gemini requests go to a protobuf validator that
 * wants uppercase type enums; Claude requests are forwarded to Anthropic, which
 * validates against real JSON Schema draft 2020-12 and rejects those same uppercase
 * types outright. One output cannot satisfy both.
 */
export type SchemaDialect = 'gemini' | 'json-schema';

/**
 * Annotation keywords VS Code and MCP servers attach that mean nothing to either
 * validator. Legal in JSON Schema — unknown keywords are allowed — but dropped to keep
 * the payload to what actually describes the tool.
 */
/** Keys inside these objects are property names, not keywords, and are never filtered. */
const NAME_KEYED_CONTAINERS = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

const NON_STANDARD_KEYWORDS = new Set([
	'enumDescriptions',
	'markdownDescription',
	'markdownEnumDescriptions',
	'deprecationMessage',
	'defaultSnippets',
	'patternErrorMessage',
	'errorMessage',
	'editPresentation',
	'scope',
	'order',
	'tags',
	'doNotSuggest',
]);

/**
 * Draft 2020-12 output: keep the schema as authored, minus the editor-only annotations.
 * Types stay lowercase — uppercasing them is exactly what Anthropic rejects.
 */
function sanitizeForJsonSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) {
		return schema.map(sanitizeForJsonSchema);
	}
	if (schema === null || typeof schema !== 'object') {
		return schema;
	}

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		// Inside these, the keys are author-chosen names, not schema keywords. Filtering
		// them by keyword would silently delete a property genuinely called "tags" or
		// "scope" and change the tool's contract.
		if (NAME_KEYED_CONTAINERS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
			const mapped: Record<string, unknown> = {};
			for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
				mapped[name] = sanitizeForJsonSchema(sub);
			}
			out[key] = mapped;
			continue;
		}
		if (NON_STANDARD_KEYWORDS.has(key)) {
			continue;
		}
		out[key] = sanitizeForJsonSchema(value);
	}
	return out;
}

/** Rewrites a tool schema into whatever the model's validator will accept. */
export function sanitizeSchema(schema: unknown, dialect: SchemaDialect = 'gemini'): unknown {
	return dialect === 'json-schema' ? sanitizeForJsonSchema(schema) : sanitizeForGemini(schema);
}

/**
 * The complete set of fields the gateway's `Schema` proto defines.
 *
 * This is an ALLOWLIST, not a denylist, and that distinction is the whole point.
 * The gateway parses schemas with protobuf JSON, which hard-fails on any unrecognised
 * key ("Unknown name X ... Cannot find field") rather than ignoring it. JSON Schema
 * has a long tail of annotation keywords, and VS Code and MCP servers add their own on
 * top (`enumDescriptions`, `markdownDescription`, `deprecationMessage`, …). Enumerating
 * what to remove is a losing game — one unknown keyword anywhere in a 40-tool payload
 * fails the entire request. So anything not listed here is dropped.
 */
const ALLOWED_KEYWORDS = new Set([
	'type',
	'format',
	'description',
	'nullable',
	'enum',
	'items',
	'properties',
	'required',
	'anyOf',
	'propertyOrdering',
	'minimum',
	'maximum',
	'minItems',
	'maxItems',
	'minLength',
	'maxLength',
	'minProperties',
	'maxProperties',
	'pattern',
]);

/** The only `format` values the gateway accepts on a string. */
const ALLOWED_STRING_FORMATS = new Set(['enum', 'date-time']);

const VALID_TYPES = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT']);

/**
 * Rewrites a JSON Schema into the subset the gateway accepts.
 *
 * The two rewrites that matter (rather than plain deletions): `const: X` becomes
 * `enum: [X]`, which is the documented substitution, and `oneOf`/`allOf` collapse into
 * `anyOf`, which is the only composition keyword supported.
 */
function sanitizeForGemini(schema: unknown): unknown {
	if (Array.isArray(schema)) {
			return schema.map(sanitizeForGemini);
	}
	if (schema === null || typeof schema !== 'object') {
		return schema;
	}

	const input = schema as Record<string, unknown>;
	const output: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(input)) {
		if (key === 'const') {
			// A single-value enum is the documented replacement for const.
			output.enum = [typeof value === 'string' ? value : String(value)];
			continue;
		}
		if (key === 'oneOf' || key === 'allOf') {
			if (Array.isArray(value) && value.length > 0) {
				output.anyOf = value.map(sanitizeForGemini);
			}
			continue;
		}
		if (!ALLOWED_KEYWORDS.has(key)) {
			continue;
		}
		if (key === 'type') {
			const normalized = normalizeType(value);
			if (normalized) {
				output.type = normalized;
			}
			// A `["string", "null"]` union carries nullability the proto expresses
			// with a separate field.
			if (Array.isArray(value) && value.includes('null')) {
				output.nullable = true;
			}
			continue;
		}
		if (key === 'format') {
			if (typeof value === 'string' && ALLOWED_STRING_FORMATS.has(value)) {
				output.format = value;
			}
			continue;
		}
		if (key === 'enum') {
			// Proto enums are string-valued; numeric or boolean members fail parsing.
			if (Array.isArray(value)) {
				output.enum = value.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
			}
			continue;
		}
		if (key === 'properties' && value && typeof value === 'object') {
			const properties: Record<string, unknown> = {};
			for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
				properties[name] = sanitizeForGemini(sub);
			}
			output.properties = properties;
			continue;
		}
		if (key === 'description') {
			if (typeof value === 'string') {
				output.description = value;
			}
			continue;
		}
		output[key] = sanitizeForGemini(value);
	}

	// The validator wants an explicit type; infer it from whatever survived.
	if (output.properties && !output.type) {
		output.type = 'OBJECT';
	}
	if (output.items && !output.type) {
		output.type = 'ARRAY';
	}
	if (output.enum && !output.type) {
		output.type = 'STRING';
	}

	// `required` must only name properties that survived sanitization.
	if (Array.isArray(output.required) && output.properties) {
		const known = new Set(Object.keys(output.properties as Record<string, unknown>));
		output.required = (output.required as unknown[]).filter((name) => typeof name === 'string' && known.has(name));
		if ((output.required as unknown[]).length === 0) {
			delete output.required;
		}
	}

	return output;
}

/** Proto enums are case-sensitive, so `"string"` must become `"STRING"`. */
function normalizeType(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		// JSON Schema unions like ["string", "null"]: keep the first real type.
		const first = value.find((entry) => typeof entry === 'string' && entry !== 'null');
		return normalizeType(first);
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const upper = value.toUpperCase();
	return VALID_TYPES.has(upper) ? upper : undefined;
}

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;

/**
 * Maps tool names between VS Code's namespace and the gateway's.
 *
 * MCP servers routinely produce names with slashes or a leading digit, both of which
 * the gateway rejects. Sanitizing is lossy, so the mapping has to be kept for the
 * round trip — an inbound `functionCall` names the sanitized form and we must resolve
 * it back to the tool VS Code knows.
 */
export class ToolNameMap {
	private readonly toWire = new Map<string, string>();
	private readonly fromWire = new Map<string, string>();

	/** Returns the gateway-safe name for a VS Code tool. */
	register(original: string): string {
		const existing = this.toWire.get(original);
		if (existing) {
			return existing;
		}

		let wire = sanitizeToolName(original);
		if (this.fromWire.has(wire) && this.fromWire.get(wire) !== original) {
			// Two different tools sanitized to the same name; disambiguate.
			wire = disambiguate(wire, this.fromWire.size);
		}

		this.toWire.set(original, wire);
		this.fromWire.set(wire, original);
		return wire;
	}

	/** Resolves a name the gateway sent back. Unknown names pass through unchanged. */
	resolve(wire: string): string {
		return this.fromWire.get(wire) ?? wire;
	}
}

export function sanitizeToolName(name: string): string {
	if (VALID_NAME.test(name)) {
		return name;
	}

	let cleaned = name.replace(/[^A-Za-z0-9_.:-]/g, '_');
	if (!/^[A-Za-z_]/.test(cleaned)) {
		cleaned = `t_${cleaned}`;
	}
	if (cleaned.length > 64) {
		// Truncating alone would collide; a short digest of the original keeps it unique.
		cleaned = `${cleaned.slice(0, 55)}_${shortHash(name)}`;
	}
	return cleaned;
}

function disambiguate(wire: string, index: number): string {
	const suffix = `_${index}`;
	const base = wire.length + suffix.length > 64 ? wire.slice(0, 64 - suffix.length) : wire;
	return `${base}${suffix}`;
}

function shortHash(value: string): string {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36).slice(0, 8);
}
