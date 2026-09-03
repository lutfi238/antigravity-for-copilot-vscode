import { describe, expect, it } from 'vitest';
import { userAgent } from '../src/api/constants';

describe('Antigravity CLI fingerprint', () => {
	it('tracks the installed CLI version that exposes Gemini 3.8 Flash', () => {
		expect(userAgent()).toMatch(/^antigravity\/cli\/1\.1\.25 /);
	});
});
