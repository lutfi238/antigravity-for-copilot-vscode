import { describe, expect, it } from 'vitest';
import { buildAgySearchPrompt, parseAgySearchStream } from '../src/agyCli';

describe('agyCli search bridge', () => {
	it('builds a single-tool search prompt without losing the query', () => {
		const prompt = buildAgySearchPrompt('latest Gemini updates');
		expect(prompt).toContain('Use the built-in search_web tool exactly once.');
		expect(prompt).toContain('Search query: "latest Gemini updates"');
		expect(prompt).toContain('Do not use any other tool');
	});

	it('accepts a successful stream only after native search_web ran', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { tools: ['search_web'] } }),
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'search_web',
					tool_info: { name: 'search_web', parameters: { query: 'Gemini' } },
				},
			}),
			JSON.stringify({
				event: 'result',
				result: { status: 'SUCCESS', response: '**Sources** https://example.com' },
			}),
		]);

		expect(result).toEqual({
			status: 'SUCCESS',
			response: '**Sources** https://example.com',
			sawSearchWeb: true,
		});
	});

	it('rejects a final success when the native search step failed', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'search_web',
					tool_info: { name: 'search_web', error: { message: '503 Service Unavailable' } },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'No source URLs.' } }),
		]);

		expect(result.sawSearchWeb).toBe(true);
		expect(result.toolError).toBe('503 Service Unavailable');
	});

	it('does not treat an unrelated tool as web search', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_type: 'tool', tool_name: 'read_url_content' },
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'fetched' } }),
		]);

		expect(result.sawSearchWeb).toBe(false);
		expect(result.status).toBe('SUCCESS');
	});
});
