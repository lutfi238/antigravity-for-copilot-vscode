import { describe, expect, it } from 'vitest';
import { StreamEvidence, MAX_CASES, buildConsentDetail, buildProbeRequest } from '../src/devProbe';
import { readSse } from '../src/api/stream';
import { GenerateContentResponse } from '../src/translate/types';

/** Builds a Response whose body emits exactly the given chunks, byte for byte. */
function responseOf(chunks: string[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
	return new Response(stream);
}

/** Drains a stream exactly the way the probe does, then classifies it. */
async function classifyStream(chunks: string[]) {
	const evidence = new StreamEvidence();
	for await (const chunk of readSse<GenerateContentResponse>(responseOf(chunks), 'probe')) {
		evidence.observe(chunk);
	}
	return evidence.classify();
}

describe('StreamEvidence', () => {
	it('accepts only when a candidate actually arrived', async () => {
		const result = await classifyStream([
			'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}]}}\n\n',
			'data: [DONE]\n\n',
		]);
		expect(result.status).toBe('accepted');
		expect(result.detail).toContain('candidates=1');
		expect(result.detail).toContain('textParts=1');
	});

	it('reports an error envelope delivered inside the stream', async () => {
		// readSse parses this happily and never throws, so a clean EOF is not success.
		const result = await classifyStream([
			'data: {"error":{"code":404,"message":"model not found: gemini-4-hydrogen-sonar-low"}}\n\n',
		]);
		expect(result.status).toBe('error');
		expect(result.detail).toContain('404');
		expect(result.detail).toContain('model not found');
	});

	it('reports an error nested under response', async () => {
		const result = await classifyStream([
			'data: {"response":{"error":{"status":"INVALID_ARGUMENT","message":"unknown thinkingLevel"}}}\n\n',
		]);
		expect(result.status).toBe('error');
		expect(result.detail).toContain('INVALID_ARGUMENT');
	});

	it('is inconclusive when the stream is only [DONE]', async () => {
		const result = await classifyStream(['data: [DONE]\n\n']);
		expect(result.status).toBe('inconclusive');
		expect(result.detail).toContain('no generation evidence');
	});

	it('is inconclusive when every event is malformed', async () => {
		// readSse skips unparseable frames, so the probe would otherwise see a clean EOF.
		const result = await classifyStream(['data: {not json\n\n', 'data: also broken\n\n']);
		expect(result.status).toBe('inconclusive');
	});

	it('is inconclusive on a completely empty stream', async () => {
		const result = await classifyStream([]);
		expect(result.status).toBe('inconclusive');
	});

	it('accepts usage-only evidence, which proves the model ran', async () => {
		const result = await classifyStream([
			'data: {"response":{"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}}\n\n',
		]);
		expect(result.status).toBe('accepted');
		expect(result.detail).toContain('prompt=5');
	});

	it('treats a later error as authoritative even after candidates arrived', async () => {
		const result = await classifyStream([
			'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]}}]}\n\n',
			'data: {"error":{"code":429,"message":"quota exhausted"}}\n\n',
		]);
		expect(result.status).toBe('error');
		expect(result.detail).toContain('429');
	});

	it('handles an error with no status field', async () => {
		const result = await classifyStream(['data: {"error":{"message":"boom"}}\n\n']);
		expect(result.status).toBe('error');
		expect(result.detail).toBe('boom');
	});

	it('handles a string error payload', async () => {
		const result = await classifyStream(['data: {"error":"plain failure"}\n\n']);
		expect(result.status).toBe('error');
		expect(result.detail).toBe('plain failure');
	});

	it('reports thought tokens, the only per-request depth signal', async () => {
		const result = await classifyStream([
			'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":1,"thoughtsTokenCount":412}}}\n\n',
		]);
		expect(result.status).toBe('accepted');
		expect(result.detail).toContain('thoughts=412');
		expect(result.detail).toContain('finish=STOP');
	});

	it('omits thoughts when the gateway reports none', async () => {
		const result = await classifyStream([
			'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]}}]}\n\n',
		]);
		expect(result.detail).not.toContain('thoughts=');
	});

	it('does not treat a truncated answer as a failure of the level', async () => {
		// MAX_TOKENS at a 32-token cap is a probe artifact, not evidence about effort.
		const result = await classifyStream([
			'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"MAX_TOKENS"}]}\n\n',
		]);
		expect(result.status).toBe('accepted');
		expect(result.detail).toContain('finish=MAX_TOKENS');
	});
});

describe('probe bounds and consent', () => {
	it('caps a run at MAX_CASES requests', () => {
		expect(MAX_CASES).toBeGreaterThan(0);
		// The level sweep itself must fit, or the baseline or control would be dropped.
		expect(MAX_CASES).toBeGreaterThanOrEqual(6);
	});

	it('names every request the user is authorizing', () => {
		const detail = buildConsentDetail(
			[
				{ model: 'gemini-4-hydrogen-sonar' },
				{ model: 'gemini-4-hydrogen-sonar', level: 'xhigh' },
			],
			2,
		);
		expect(detail).toContain('2 generation request(s)');
		expect(detail).toContain('no thinkingLevel');
		expect(detail).toContain('thinkingLevel=xhigh');
		expect(detail).toContain('spends real quota');
		expect(detail).not.toContain('dropped');
	});

	it('discloses how many cases the limit removed', () => {
		// A pasted list must never be silently truncated: the user is told what was cut.
		const detail = buildConsentDetail([{ model: 'a' }], 9);
		expect(detail).toContain('8 extra case(s) were dropped');
		expect(detail).toContain(`${MAX_CASES}-case limit`);
	});
});

describe('buildProbeRequest', () => {
	it('holds includeThoughts constant so only thinkingLevel varies', () => {
		// A baseline that also dropped thinkingConfig would change two fields at once, so
		// no difference between baseline and level runs could be attributed to the level.
		const baseline = buildProbeRequest(undefined);
		const level = buildProbeRequest('xhigh');

		expect(baseline.generationConfig?.thinkingConfig).toEqual({ includeThoughts: true });
		expect(level.generationConfig?.thinkingConfig).toEqual({
			includeThoughts: true,
			thinkingLevel: 'xhigh',
		});
		// Everything else is byte-identical between the two cases.
		expect(baseline.contents).toEqual(level.contents);
		expect(baseline.generationConfig?.maxOutputTokens).toBe(level.generationConfig?.maxOutputTokens);
	});

	it('sends the negative control as an ordinary level', () => {
		// The control must travel the same path as a real level, or its refusal would
		// prove nothing about how real levels are validated.
		const control = buildProbeRequest('bogus-level');
		expect(control.generationConfig?.thinkingConfig).toEqual({
			includeThoughts: true,
			thinkingLevel: 'bogus-level',
		});
	});
});
