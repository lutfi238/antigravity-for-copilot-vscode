/**
 * Rewrites tool schemas into what the Antigravity gateway accepts.
 *
 * Two validators sit in series and both must pass. The gateway parses `parameters`
 * with protobuf JSON, which hard-fails on any unrecognised key ("Unknown name X ...
 * Cannot find field"). For Claude the request is then forwarded to Anthropic, which
 * validates real JSON Schema draft 2020-12. Types therefore stay lowercase — the
 * gateway accepts them and uppercase proto enum names are what Anthropic rejects.
 */

/** Constraints the gateway drops. Their meaning is preserved as a description hint. */
const UNSUPPORTED_CONSTRAINTS = [
	'minLength',
	'maxLength',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'pattern',
	'minItems',
	'maxItems',
	'format',
	'default',
	'examples',
] as const;

/** Everything the gateway's protobuf has no field for. */
const UNSUPPORTED_KEYWORDS = new Set<string>([
	...UNSUPPORTED_CONSTRAINTS,
	'$schema',
	'$defs',
	'definitions',
	'const',
	'$ref',
	'additionalProperties',
	'propertyNames',
	'title',
	'$id',
	'$comment',
	// Editor-only annotations VS Code and MCP servers attach.
	'enumDescriptions',
	'markdownDescription',
	'markdownEnumDescriptions',
	'deprecationMessage',
	'defaultSnippets',
	'errorMessage',
	'patternErrorMessage',
	'editPresentation',
	'doNotSuggest',
]);

/** Keys inside these are author-chosen names, never keywords. */
const NAME_KEYED_CONTAINERS = new Set(['properties', 'patternProperties']);

/** Claude's validated tool mode rejects an object schema with no properties. */
const PLACEHOLDER = '_placeholder';

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function appendHint(schema: Obj, hint: string): void {
	const existing = typeof schema.description === 'string' ? schema.description : '';
	schema.description = existing ? `${existing} (${hint})` : hint;
}

/**
 * Rewrites one schema node. Constraints the gateway cannot express are folded into the
 * description so the model still knows about them, then removed.
 */
function clean(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(clean);
	}
	if (!isObj(node)) {
		return node;
	}

	const out: Obj = {};

	// `const: X` has no proto field; a single-value enum says the same thing.
	if ('const' in node && !('enum' in node)) {
		out.enum = [node.const];
	}

	for (const [key, value] of Object.entries(node)) {
		// MCP/JSON-Schema providers commonly attach vendor annotations as x-* keys.
		// They are valid metadata for the host, but the Antigravity Schema protobuf
		// rejects them as unknown fields. Property names remain untouched because
		// NAME_KEYED_CONTAINERS are handled below as author-chosen map keys.
		if (UNSUPPORTED_KEYWORDS.has(key) || /^x-/i.test(key)) {
			continue;
		}

		if (NAME_KEYED_CONTAINERS.has(key) && isObj(value)) {
			// Filtering these keys by keyword would delete a tool parameter genuinely
			// named "title" or "pattern" and silently change the tool's contract.
			const mapped: Obj = {};
			for (const [name, sub] of Object.entries(value)) {
				mapped[name] = clean(sub);
			}
			out[key] = mapped;
			continue;
		}

		if (key === 'allOf' || key === 'oneOf' || key === 'anyOf') {
			// Only one composition survives; take the first branch and note the rest.
			const branches = Array.isArray(value) ? value.filter(isObj) : [];
			if (branches.length > 0) {
				Object.assign(out, clean(branches[0]) as Obj);
				if (branches.length > 1) {
					appendHint(out, `one of ${branches.length} accepted shapes`);
				}
			}
			continue;
		}

		if (key === 'type') {
			// `["string", "null"]` collapses to the concrete type; lowercase is kept.
			const resolved = Array.isArray(value)
				? value.find((entry) => typeof entry === 'string' && entry !== 'null')
				: value;
			if (typeof resolved === 'string') {
				out.type = resolved.toLowerCase();
			}
			continue;
		}

		out[key] = clean(value);
	}

	// Fold dropped constraints into the description rather than losing them silently.
	const notes: string[] = [];
	for (const key of UNSUPPORTED_CONSTRAINTS) {
		const value = node[key];
		if (value !== undefined && typeof value !== 'object') {
			notes.push(`${key}: ${String(value)}`);
		}
	}
	if (notes.length > 0) {
		appendHint(out, notes.join(', '));
	}

	// An explicit type is required; infer it from whatever survived.
	if (!out.type) {
		if (out.properties) {
			out.type = 'object';
		} else if (out.items) {
			out.type = 'array';
		} else if (out.enum) {
			out.type = 'string';
		}
	}

	// `required` may only name properties that still exist.
	if (Array.isArray(out.required) && isObj(out.properties)) {
		const known = new Set(Object.keys(out.properties));
		out.required = (out.required as unknown[]).filter((n) => typeof n === 'string' && known.has(n));
		if ((out.required as unknown[]).length === 0) {
			delete out.required;
		}
	}

	return out;
}

/** Gives an empty object schema one property, which Claude's validated mode requires. */
function fillEmptyObjects(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(fillEmptyObjects);
	}
	if (!isObj(node)) {
		return node;
	}

	const out: Obj = {};
	for (const [key, value] of Object.entries(node)) {
		out[key] = fillEmptyObjects(value);
	}

	if (out.type === 'object' && (!isObj(out.properties) || Object.keys(out.properties).length === 0)) {
		out.properties = {
			[PLACEHOLDER]: { type: 'boolean', description: 'Placeholder. Always pass true.' },
		};
		out.required = [PLACEHOLDER];
	}
	return out;
}

export function sanitizeSchema(schema: unknown): unknown {
	return fillEmptyObjects(clean(schema));
}

/** The parameters to send for a tool that declares no input at all. */
export function emptySchema(): Obj {
	return fillEmptyObjects({ type: 'object', properties: {} }) as Obj;
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
