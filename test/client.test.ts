import { describe, expect, it } from 'vitest';
import { summarizeRequest } from '../src/api/client';

describe('summarizeRequest', () => {
	it('counts calls and how many carry an id', () => {
		const shape = summarizeRequest({
			request: {
				contents: [
					{ role: 'user', parts: [{ text: 'read it' }] },
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'a.ts' }, id: 'call-1' } }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { output: 'x' }, id: 'call-1' } }] },
				],
			},
		})!;

		expect(shape.calls).toBe('1');
		expect(shape.callIds).toBe('1');
		expect(shape.responses).toBe('1');
		expect(shape.responseIds).toBe('1');
		expect(shape.b0).toBe('user:text');
		expect(shape.b1).toBe('model:call');
		expect(shape.b2).toBe('user:result');
	});

	it('never includes prompt text, tool names, arguments, or results', () => {
		const shape = summarizeRequest({
			request: {
				contents: [
					{
						role: 'model',
						parts: [
							{ functionCall: { name: 'read_file', args: { secret: 'TOP_SECRET_ARG' }, id: 'call-1' } },
						],
					},
				],
			},
		})!;

		expect(JSON.stringify(shape)).not.toContain('TOP_SECRET_ARG');
		expect(JSON.stringify(shape)).not.toContain('read_file');
	});

	it('counts every block but lists only the most recent ones', () => {
		const contents = Array.from({ length: 40 }, (_, i) => ({
			role: i % 2 === 0 ? 'user' : 'model',
			parts: [{ text: 'x' }],
		}));
		const shape = summarizeRequest({ request: { contents } })!;

		expect(shape.blocks).toBe('40');
		expect(shape.b0).toBeUndefined();
		expect(shape.b27).toBeUndefined();
		expect(shape.b28).toBe('user:text');
		expect(shape.b39).toBe('model:text');
	});

	it('counts only non-empty string ids', () => {
		const shape = summarizeRequest({
			request: {
				contents: [
					{
						role: 'model',
						parts: [
							{ functionCall: { name: 'a', id: 'c1' } },
							{ functionCall: { name: 'a', id: '' } },
							{ functionCall: { name: 'a', id: 0 } },
							{ functionCall: { name: 'a' } },
						],
					},
					{
						role: 'user',
						parts: [
							{ functionResponse: { name: 'a', id: 'c1' } },
							{ functionResponse: { name: 'a', id: false } },
						],
					},
				],
			},
		})!;

		expect(shape.calls).toBe('4');
		expect(shape.callIds).toBe('1');
		expect(shape.responses).toBe('2');
		expect(shape.responseIds).toBe('1');
	});

	it('tolerates malformed contents without throwing', () => {
		const shape = summarizeRequest({
			request: { contents: [null, 'x', { role: 'user', parts: 'nope' }, { parts: [null, { text: 'hi' }] }] },
		})!;

		expect(shape.b0).toBe('user:empty');
		expect(shape.b1).toBe('?:text');
		expect(shape.calls).toBe('0');
	});

	it('returns undefined for a body with no conversation contents', () => {
		expect(summarizeRequest({})).toBeUndefined();
		expect(summarizeRequest({ request: { contents: [] } })).toBeUndefined();
	});
});
