import { describe, expect, it } from 'vitest';
import { userAgent } from '../src/api/constants';

describe('Antigravity CLI fingerprint', () => {
	it('pins the CLI version and changelist to the officially released 1.5.7', () => {
		expect(userAgent()).toMatch(/^antigravity\/cli\/1\.5\.7 \(.*cl=1019769835; auth_method=consumer\)$/);
	});
});
