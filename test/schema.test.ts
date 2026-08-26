import { describe, expect, it } from 'vitest';
import { sanitizeSchema, sanitizeToolName, ToolNameMap } from '../src/translate/schema';

describe('sanitizeSchema', () => {
	it('rewrites const into a single-value enum', () => {
		expect(sanitizeSchema({ const: 'fixed' })).toEqual({ enum: ['fixed'], type: 'STRING' });
	});

	it('strips enumDescriptions, the VS Code keyword that broke agent mode', () => {
		// The gateway parses with protobuf JSON and hard-fails on any unknown key:
		// "Unknown name enumDescriptions ... Cannot find field". One such keyword
		// anywhere in a 40-tool payload fails the whole request.
		const result = sanitizeSchema({
			type: 'string',
			enum: ['a', 'b'],
			enumDescriptions: ['first', 'second'],
		}) as any;
		expect(result).toEqual({ type: 'STRING', enum: ['a', 'b'] });
	});

	it('drops unknown keywords by default rather than by name', () => {
		// An allowlist means keywords nobody has seen yet are handled too.
		const result = sanitizeSchema({
			type: 'string',
			markdownDescription: 'x',
			deprecationMessage: 'y',
			defaultSnippets: [],
			someFutureKeyword: 1,
		}) as any;
		expect(result).toEqual({ type: 'STRING' });
	});

	it('preserves the fields the proto does define', () => {
		const result = sanitizeSchema({
			type: 'array',
			description: 'a list',
			minItems: 1,
			maxItems: 5,
			items: { type: 'string', pattern: '^a', minLength: 1 },
		}) as any;
		expect(result).toEqual({
			type: 'ARRAY',
			description: 'a list',
			minItems: 1,
			maxItems: 5,
			items: { type: 'STRING', pattern: '^a', minLength: 1 },
		});
	});

	it('converts a nullable union into the proto nullable field', () => {
		expect(sanitizeSchema({ type: ['string', 'null'] })).toEqual({ type: 'STRING', nullable: true });
	});

	it('stringifies non-string enum members', () => {
		expect(sanitizeSchema({ enum: [1, true, 'x'] })).toEqual({
			type: 'STRING',
			enum: ['1', 'true', 'x'],
		});
	});

	it('strips the keywords the gateway rejects', () => {
		const result = sanitizeSchema({
			type: 'object',
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			$id: 'urn:x',
			$defs: { a: {} },
			additionalProperties: false,
			default: {},
			examples: [1],
			title: 'Thing',
			properties: { a: { type: 'string' } },
		}) as Record<string, unknown>;

		for (const key of ['$schema', '$id', '$defs', 'additionalProperties', 'default', 'examples', 'title']) {
			expect(result).not.toHaveProperty(key);
		}
		expect(result.type).toBe('OBJECT');
	});

	it('uppercases types, since proto enums are case-sensitive', () => {
		const result = sanitizeSchema({
			type: 'object',
			properties: { count: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
		}) as any;

		expect(result.type).toBe('OBJECT');
		expect(result.properties.count.type).toBe('INTEGER');
		expect(result.properties.tags.type).toBe('ARRAY');
		expect(result.properties.tags.items.type).toBe('STRING');
	});

	it('collapses oneOf and allOf into anyOf', () => {
		const result = sanitizeSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] }) as any;
		expect(result.anyOf).toHaveLength(2);
		expect(result).not.toHaveProperty('oneOf');
	});

	it('narrows a non-null union to its first concrete type', () => {
		expect(sanitizeSchema({ type: ['string', 'number'] })).toEqual({ type: 'STRING' });
	});

	it('keeps date-time format but drops unsupported ones', () => {
		expect(sanitizeSchema({ type: 'string', format: 'date-time' })).toEqual({
			type: 'STRING',
			format: 'date-time',
		});
		expect(sanitizeSchema({ type: 'string', format: 'uri' })).toEqual({ type: 'STRING' });
	});

	it('drops required entries whose property did not survive', () => {
		const result = sanitizeSchema({
			type: 'object',
			properties: { kept: { type: 'string' } },
			required: ['kept', 'gone'],
		}) as any;
		expect(result.required).toEqual(['kept']);
	});

	it('recurses through nested properties', () => {
		const result = sanitizeSchema({
			type: 'object',
			properties: { outer: { type: 'object', properties: { inner: { const: 7 } } } },
		}) as any;
		expect(result.properties.outer.properties.inner).toEqual({ enum: ['7'], type: 'STRING' });
	});
});

describe('sanitizeToolName', () => {
	it('leaves valid names untouched', () => {
		expect(sanitizeToolName('read_file')).toBe('read_file');
		expect(sanitizeToolName('mcp.server:tool-1')).toBe('mcp.server:tool-1');
	});

	it('replaces slashes, which the gateway rejects', () => {
		expect(sanitizeToolName('github/create_issue')).toBe('github_create_issue');
	});

	it('prefixes names that start with a digit', () => {
		// MCP servers named like `1mcp_*` fail validation without this.
		expect(sanitizeToolName('1mcp_search')).toBe('t_1mcp_search');
	});

	it('truncates over-long names without losing uniqueness', () => {
		const a = sanitizeToolName(`${'x'.repeat(80)}_alpha/1`);
		const b = sanitizeToolName(`${'x'.repeat(80)}_beta/1`);
		expect(a.length).toBeLessThanOrEqual(64);
		expect(b.length).toBeLessThanOrEqual(64);
		expect(a).not.toBe(b);
	});
});

describe('ToolNameMap', () => {
	it('round-trips a sanitized name back to the original', () => {
		const map = new ToolNameMap();
		const wire = map.register('github/create_issue');
		expect(wire).toBe('github_create_issue');
		expect(map.resolve(wire)).toBe('github/create_issue');
	});

	it('is stable across repeated registration', () => {
		const map = new ToolNameMap();
		expect(map.register('a/b')).toBe(map.register('a/b'));
	});

	it('disambiguates distinct tools that sanitize to the same name', () => {
		const map = new ToolNameMap();
		const first = map.register('a/b');
		const second = map.register('a:b'); // valid already, so no clash
		const third = map.register('a|b'); // sanitizes to a_b, clashing with the first
		expect(first).toBe('a_b');
		expect(second).toBe('a:b');
		expect(third).not.toBe(first);
		expect(map.resolve(third)).toBe('a|b');
		expect(map.resolve(first)).toBe('a/b');
	});

	it('passes unknown inbound names through unchanged', () => {
		expect(new ToolNameMap().resolve('never_seen')).toBe('never_seen');
	});
});
