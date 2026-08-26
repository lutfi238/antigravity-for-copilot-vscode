import { describe, expect, it } from 'vitest';
import { readSse } from '../src/api/stream';

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

async function collect<T>(response: Response): Promise<T[]> {
	const out: T[] = [];
	for await (const event of readSse<T>(response, 'test')) {
		out.push(event);
	}
	return out;
}

describe('readSse', () => {
	it('parses well-formed events', async () => {
		const events = await collect<{ n: number }>(
			responseOf(['data: {"n":1}\n\n', 'data: {"n":2}\n\n']),
		);
		expect(events).toEqual([{ n: 1 }, { n: 2 }]);
	});

	it('reassembles events split across chunk boundaries', async () => {
		// Network chunks do not respect event boundaries; this is the common failure.
		const events = await collect<{ text: string }>(
			responseOf(['data: {"te', 'xt":"hel', 'lo"}\n', '\ndata: {"text":"bye"}\n\n']),
		);
		expect(events).toEqual([{ text: 'hello' }, { text: 'bye' }]);
	});

	it('handles CRLF separators', async () => {
		const events = await collect<{ n: number }>(responseOf(['data: {"n":1}\r\n\r\n']));
		expect(events).toEqual([{ n: 1 }]);
	});

	it('concatenates multi-line data fields', async () => {
		const events = await collect<{ a: string }>(responseOf(['data: {"a":\ndata: "b"}\n\n']));
		expect(events).toEqual([{ a: 'b' }]);
	});

	it('emits a final event that lacks a trailing blank line', async () => {
		const events = await collect<{ n: number }>(responseOf(['data: {"n":9}']));
		expect(events).toEqual([{ n: 9 }]);
	});

	it('ignores [DONE] sentinels and comment lines', async () => {
		const events = await collect<{ n: number }>(
			responseOf([': keep-alive\n\n', 'data: {"n":1}\n\n', 'data: [DONE]\n\n']),
		);
		expect(events).toEqual([{ n: 1 }]);
	});

	it('skips an unparseable event rather than aborting the stream', async () => {
		const events = await collect<{ n: number }>(
			responseOf(['data: {not json}\n\n', 'data: {"n":2}\n\n']),
		);
		expect(events).toEqual([{ n: 2 }]);
	});

	it('rejects a response with no body', async () => {
		await expect(collect(new Response(null))).rejects.toThrow(/empty stream/);
	});
});
