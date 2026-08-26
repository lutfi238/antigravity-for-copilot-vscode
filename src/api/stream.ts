import { log } from '../log';

/**
 * Reads a `text/event-stream` body and yields each parsed `data:` payload.
 *
 * Chunk boundaries do not respect event boundaries, so the trailing partial line is
 * carried across reads. Events are separated by a blank line; multi-line `data:` fields
 * are concatenated per the SSE spec.
 */
export async function* readSse<T>(response: Response, op: string): AsyncGenerator<T> {
	const body = response.body;
	if (!body) {
		throw new Error('Antigravity returned an empty stream.');
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let events = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });

			let separator = findSeparator(buffer);
			while (separator) {
				const raw = buffer.slice(0, separator.index);
				buffer = buffer.slice(separator.index + separator.length);
				const parsed = parseEvent<T>(raw, op);
				if (parsed !== undefined) {
					events++;
					yield parsed;
				}
				separator = findSeparator(buffer);
			}
		}

		// A final event may arrive without a trailing blank line.
		const parsed = parseEvent<T>(buffer, op);
		if (parsed !== undefined) {
			events++;
			yield parsed;
		}
	} finally {
		log.debug(op, 'stream closed', { events });
		reader.releaseLock();
	}
}

function findSeparator(buffer: string): { index: number; length: number } | undefined {
	const lf = buffer.indexOf('\n\n');
	const crlf = buffer.indexOf('\r\n\r\n');
	if (crlf >= 0 && (lf < 0 || crlf < lf)) {
		return { index: crlf, length: 4 };
	}
	if (lf >= 0) {
		return { index: lf, length: 2 };
	}
	return undefined;
}

function parseEvent<T>(raw: string, op: string): T | undefined {
	const data = raw
		.split(/\r?\n/)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trimStart())
		.join('');

	if (!data || data === '[DONE]') {
		return undefined;
	}

	try {
		return JSON.parse(data) as T;
	} catch {
		log.warn(op, 'skipping unparseable stream event', { bytes: data.length });
		return undefined;
	}
}
