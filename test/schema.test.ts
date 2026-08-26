import { describe, expect, it } from 'vitest';
import { emptySchema, sanitizeSchema, sanitizeToolName, ToolNameMap } from '../src/translate/schema';

describe('sanitizeSchema', () => {
	it('keeps types lowercase — both validators depend on it', () => {
		// The gateway accepts lowercase; Anthropic rejects uppercase proto enum names
		// with "input_schema: JSON schema is invalid. It must match draft 2020-12".
		const out = sanitizeSchema({
			type: 'object',
			properties: { count: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
		}) as any;
		expect(out.type).toBe('object');
		expect(out.properties.count.type).toBe('integer');
		expect(out.properties.tags.items.type).toBe('string');
	});

	it('strips $comment, which the gateway rejected on five tools at once', () => {
		const out = sanitizeSchema({ type: 'string', $comment: 'note' }) as any;
		expect(out).toEqual({ type: 'string' });
	});

	it('strips every keyword the protobuf has no field for', () => {
		const out = sanitizeSchema({
			type: 'object',
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			$id: 'urn:x',
			$defs: { a: {} },
			$ref: '#/$defs/a',
			additionalProperties: false,
			propertyNames: { pattern: '^a' },
			title: 'Thing',
			properties: { a: { type: 'string' } },
		}) as any;

		for (const key of ['$schema', '$id', '$defs', '$ref', 'additionalProperties', 'propertyNames', 'title']) {
			expect(out).not.toHaveProperty(key);
		}
		expect(out.properties.a.type).toBe('string');
	});

	it('strips editor-only annotations', () => {
		const out = sanitizeSchema({
			type: 'string',
			enum: ['a'],
			enumDescriptions: ['first'],
			markdownDescription: 'x',
			defaultSnippets: [],
		}) as any;
		expect(out).toEqual({ type: 'string', enum: ['a'] });
	});

	it('preserves dropped constraints as a description hint rather than losing them', () => {
		// The model still needs to know a value is capped, even if the wire cannot say so.
		const out = sanitizeSchema({ type: 'string', minLength: 2, maxLength: 8, pattern: '^a' }) as any;
		expect(out.type).toBe('string');
		expect(out.minLength).toBeUndefined();
		expect(out.description).toContain('minLength: 2');
		expect(out.description).toContain('pattern: ^a');
	});

	it('keeps an existing description when appending a hint', () => {
		const out = sanitizeSchema({ type: 'string', description: 'A name', maxLength: 8 }) as any;
		expect(out.description).toBe('A name (maxLength: 8)');
	});

	it('rewrites const into a single-value enum', () => {
		const out = sanitizeSchema({ const: 'fixed' }) as any;
		expect(out.enum).toEqual(['fixed']);
		expect(out.type).toBe('string');
		expect(out).not.toHaveProperty('const');
	});

	it('collapses a nullable union to the concrete type', () => {
		expect(sanitizeSchema({ type: ['string', 'null'] })).toEqual({ type: 'string' });
	});

	it('flattens composition to its first branch and notes the rest', () => {
		const out = sanitizeSchema({
			oneOf: [
				{ type: 'object', properties: { a: { type: 'string' } } },
				{ type: 'object', properties: { b: { type: 'number' } } },
			],
		}) as any;
		expect(out).not.toHaveProperty('oneOf');
		expect(out.properties.a.type).toBe('string');
		expect(out.description).toContain('2 accepted shapes');
	});

	it('gives an empty object schema a property, which Claude requires', () => {
		const out = sanitizeSchema({ type: 'object', properties: {} }) as any;
		expect(Object.keys(out.properties)).toEqual(['_placeholder']);
		expect(out.required).toEqual(['_placeholder']);
	});

	it('builds the same placeholder for a tool that declares no input', () => {
		const out = emptySchema() as any;
		expect(out.type).toBe('object');
		expect(out.properties._placeholder.type).toBe('boolean');
	});

	it('drops required entries whose property did not survive', () => {
		const out = sanitizeSchema({
			type: 'object',
			properties: { kept: { type: 'string' } },
			required: ['kept', 'gone'],
		}) as any;
		expect(out.required).toEqual(['kept']);
	});

	it('never filters author-chosen property names as if they were keywords', () => {
		// A tool parameter called "title" or "pattern" must survive, even though those
		// are keywords one level up.
		const out = sanitizeSchema({
			type: 'object',
			properties: {
				title: { type: 'string' },
				pattern: { type: 'string' },
				format: { type: 'string' },
				$comment: { type: 'string' },
			},
		}) as any;
		expect(Object.keys(out.properties)).toEqual(['title', 'pattern', 'format', '$comment']);
	});

	it('recurses through nested properties', () => {
		const out = sanitizeSchema({
			type: 'object',
			properties: { outer: { type: 'object', properties: { inner: { const: 7 } } } },
		}) as any;
		expect(out.properties.outer.properties.inner.enum).toEqual([7]);
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

