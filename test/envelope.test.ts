import { describe, expect, it } from 'vitest';
import {
	buildAgentMetadata,
	buildEnvelope,
	createSession,
	fnv1a64Signed,
	orderRequestFields,
} from '../src/api/agent-metadata';
import { GeminiRequest } from '../src/translate/types';

const REQUEST: GeminiRequest = {
	contents: [
		{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] },
		{ role: 'model', parts: [{ text: 'c' }] },
	],
};

describe('fnv1a64Signed', () => {
	it('produces a signed 64-bit value as a decimal string', () => {
		const value = fnv1a64Signed('file:///workspace');
		expect(value).toMatch(/^-?\d+$/);
		expect(BigInt(value)).toBeGreaterThanOrEqual(-(2n ** 63n));
		expect(BigInt(value)).toBeLessThan(2n ** 63n);
	});

	it('is stable for the same input and differs across inputs', () => {
		expect(fnv1a64Signed('a')).toBe(fnv1a64Signed('a'));
		expect(fnv1a64Signed('a')).not.toBe(fnv1a64Signed('b'));
	});
});

describe('buildAgentMetadata', () => {
	it('builds the five-segment requestId the harness uses', () => {
		const session = createSession('file:///w');
		const meta = buildAgentMetadata(session, REQUEST, 'gemini-3.7-flash-high', 1_700_000_000_000);
		const segments = meta.requestId.split('/');
		expect(segments[0]).toBe('agent');
		expect(segments[1]).toBe(session.conversationId);
		expect(segments[2]).toBe('1700000000000');
		expect(segments[3]).toBe(session.trajectoryId);
		expect(segments).toHaveLength(5);
	});

	it('counts parts, not messages, for the step index', () => {
		const session = createSession('file:///w');
		const meta = buildAgentMetadata(session, REQUEST, 'gemini-3.7-flash-high', 1);
		expect(meta.labels.last_step_index).toBe('3');
	});

	it('attaches the model enum when one is known', () => {
		const session = createSession('file:///w');
		expect(
			buildAgentMetadata(session, REQUEST, 'gemini-3.7-flash-high', 1).labels.model_enum,
		).toBe('MODEL_PLACEHOLDER_M298');
		expect(buildAgentMetadata(session, REQUEST, 'gemini-pro-agent', 1).labels.model_enum).toBe(
			'MODEL_PLACEHOLDER_M16',
		);
	});

	it('omits the model enum for an unknown model rather than inventing one', () => {
		const session = createSession('file:///w');
		expect(buildAgentMetadata(session, REQUEST, 'gemini-9-future', 1).labels.model_enum).toBeUndefined();
	});

	it('makes the Claude flag sticky once set for the conversation', () => {
		const session = createSession('file:///w');
		const first = buildAgentMetadata(session, REQUEST, 'claude-sonnet-4-6', 1);
		expect(first.labels.used_claude).toBe('true');

		// Switching back to Gemini must not clear the flag — it records conversation
		// history, not the current turn.
		const second = buildAgentMetadata(session, REQUEST, 'gemini-3.7-flash-high', 2);
		expect(second.labels.used_claude).toBe('true');
		expect(second.labels.used_non_gemini_model).toBe('true');
	});

	it('marks GPT as non-Gemini but not as Claude', () => {
		const session = createSession('file:///w');
		const meta = buildAgentMetadata(session, REQUEST, 'gpt-oss-120b-medium', 1);
		expect(meta.labels.used_claude).toBe('false');
		expect(meta.labels.used_non_gemini_model).toBe('true');
	});
});

describe('orderRequestFields', () => {
	it('emits fields in the order the real client uses', () => {
		const ordered = orderRequestFields({
			sessionId: 's',
			generationConfig: {},
			contents: [],
			labels: {},
			tools: [],
			systemInstruction: { parts: [] },
			toolConfig: {},
		});
		expect(Object.keys(ordered)).toEqual([
			'contents',
			'systemInstruction',
			'tools',
			'toolConfig',
			'labels',
			'generationConfig',
			'sessionId',
		]);
	});

	it('keeps unknown fields, appended after the known ones', () => {
		const ordered = orderRequestFields({ extra: 1, contents: [] });
		expect(Object.keys(ordered)).toEqual(['contents', 'extra']);
	});

	it('omits fields that are absent rather than emitting undefined', () => {
		expect(Object.keys(orderRequestFields({ contents: [] }))).toEqual(['contents']);
	});
});

describe('buildEnvelope', () => {
	it('emits the outer fields in the client order with the agent markers', () => {
		const envelope = buildEnvelope({
			project: 'p',
			model: 'gemini-3.7-flash-high',
			request: { contents: [] },
			requestId: 'agent/x/1/y/2',
		});
		expect(Object.keys(envelope)).toEqual([
			'project',
			'requestId',
			'request',
			'model',
			'userAgent',
			'requestType',
		]);
		expect(envelope.userAgent).toBe('antigravity');
		expect(envelope.requestType).toBe('agent');
	});
});
