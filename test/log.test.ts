import { beforeEach, describe, expect, it, vi } from 'vitest';

const lines: string[] = [];
vi.mock('vscode', () => ({
	window: {
		createOutputChannel: () => ({
			trace: (line: string) => lines.push(`trace ${line}`),
			debug: (line: string) => lines.push(`debug ${line}`),
			info: (line: string) => lines.push(`info ${line}`),
			warn: (line: string) => lines.push(`warn ${line}`),
			error: (line: string) => lines.push(`error ${line}`),
			show() {},
			dispose() {},
		}),
	},
}));

const { initLogging, log } = await import('../src/log');

describe('log formatting', () => {
	beforeEach(() => {
		lines.length = 0;
		initLogging({ subscriptions: [] } as never);
	});

	it('omits undefined fields instead of printing k=undefined', () => {
		// A gateway that omits cachedContentTokenCount means "absent", not "undefined".
		log.info('op1', 'chat complete', {
			promptTokens: 28490,
			cachedTokens: undefined,
			toolCalls: 0,
		});
		expect(lines[0]).toBe('info [op1] chat complete promptTokens=28490 toolCalls=0');
		expect(lines[0]).not.toContain('undefined');
	});

	it('keeps a defined zero, which is a real value', () => {
		log.info('op2', 'chat complete', { cachedTokens: 0, toolCalls: 0 });
		expect(lines[0]).toBe('info [op2] chat complete cachedTokens=0 toolCalls=0');
	});

	it('drops the separator entirely when every field is undefined', () => {
		log.info('op3', 'chat complete', { cachedTokens: undefined, finishReason: undefined });
		expect(lines[0]).toBe('info [op3] chat complete');
	});

	it('still prints a message with no data', () => {
		log.info('op4', 'chat cancelled');
		expect(lines[0]).toBe('info [op4] chat cancelled');
	});

	it('renders null distinctly from undefined', () => {
		// `null` came from the gateway and may matter; only undefined is dropped.
		log.info('op5', 'x', { a: null, b: undefined });
		expect(lines[0]).toBe('info [op5] x a=null');
	});

	it('keeps the existing scrubbing rules', () => {
		log.info('op6', 'x', { long: 'a'.repeat(300), obj: { a: 1 }, n: 5, t: true });
		expect(lines[0]).toBe('info [op6] x long=<300 chars> obj=<object> n=5 t=true');
	});

	it('routes each level to its channel method', () => {
		log.trace('o', 'm'); log.debug('o', 'm'); log.warn('o', 'm'); log.error('o', 'm');
		expect(lines).toEqual(['trace [o] m', 'debug [o] m', 'warn [o] m', 'error [o] m']);
	});
});
