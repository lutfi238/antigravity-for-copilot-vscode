import { describe, expect, it } from 'vitest';
import { userAgent } from '../src/api/constants';

describe('Antigravity CLI fingerprint', () => {
	it('pins the CLI version and changelist to the installed 1.5.9 build', () => {
		expect(userAgent()).toMatch(
			/^antigravity\/cli\/1\.5\.9 \(aidev_client; os_type=.+; arch=.+; cl=1021519450; auth_method=consumer\)$/,
		);
	});

	it('keeps the header shape the gateway expects', () => {
		expect(userAgent()).not.toContain('X-Goog-Api-Client');
		expect(userAgent().split(';')).toHaveLength(5);
	});
});
