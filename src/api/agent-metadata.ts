import * as crypto from 'node:crypto';
import { GeminiRequest } from '../translate/types';

/**
 * Per-request telemetry the gateway expects from the Antigravity agent harness.
 *
 * None of this is optional dressing: requests that omit the agent envelope are treated
 * as a different client and are rejected or throttled differently. The shapes here
 * mirror the shipping client exactly.
 */

const FNV1A_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;

/** Field order inside `request`. The gateway is order-sensitive in practice. */
const REQUEST_FIELD_ORDER = [
	'contents',
	'systemInstruction',
	'tools',
	'toolConfig',
	'labels',
	'generationConfig',
	'sessionId',
] as const;

/**
 * Opaque per-model identifiers sent as a label. Models absent from this map still
 * work; they simply go unlabelled.
 */
const MODEL_ENUM: Record<string, string> = {
	'gemini-3.5-flash-extra-low': 'MODEL_PLACEHOLDER_M187',
	'gemini-3.5-flash-low': 'MODEL_PLACEHOLDER_M20',
	'gemini-3-flash-agent': 'MODEL_PLACEHOLDER_M84',
	'gemini-3.6-flash-low': 'MODEL_PLACEHOLDER_M73',
	'gemini-3.6-flash-medium': 'MODEL_PLACEHOLDER_M72',
	'gemini-3.6-flash-high': 'MODEL_PLACEHOLDER_M71',
	'gemini-3.7-flash-low': 'MODEL_PLACEHOLDER_M300',
	'gemini-3.7-flash-medium': 'MODEL_PLACEHOLDER_M299',
	'gemini-3.7-flash-high': 'MODEL_PLACEHOLDER_M298',
	'gemini-3.1-pro-low': 'MODEL_PLACEHOLDER_M36',
	'gemini-pro-agent': 'MODEL_PLACEHOLDER_M16',
	'claude-sonnet-4-6': 'MODEL_PLACEHOLDER_M35',
	'claude-opus-4-6-thinking': 'MODEL_PLACEHOLDER_M26',
	'gemini-3.1-flash-image': 'MODEL_PLACEHOLDER_M21',
	'gpt-oss-120b-medium': 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
};

/** Signed 64-bit FNV-1a, which is how the client derives its numeric session id. */
export function fnv1a64Signed(input: string): string {
	let hash = FNV1A_64_OFFSET_BASIS;
	for (const byte of Buffer.from(input, 'utf8')) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * FNV1A_64_PRIME);
	}
	return BigInt.asIntN(64, hash).toString();
}

export interface AgentSession {
	conversationId: string;
	trajectoryId: string;
	numericSessionId: string;
	lastExecutionId?: string;
	usedClaude?: boolean;
	usedNonGemini?: boolean;
}

export function createSession(workspaceUri: string): AgentSession {
	return {
		conversationId: crypto.randomUUID(),
		trajectoryId: crypto.randomUUID(),
		numericSessionId: fnv1a64Signed(workspaceUri),
	};
}

export interface AgentMetadata {
	requestId: string;
	sessionId: string;
	labels: Record<string, string>;
}

/** Counts conversation parts, which the harness reports as its step index. */
export function countSteps(request: GeminiRequest): number {
	let parts = 0;
	for (const content of request.contents ?? []) {
		parts += content.parts?.length ?? 0;
	}
	return Math.max(1, parts);
}

export function buildAgentMetadata(
	session: AgentSession,
	request: GeminiRequest,
	model: string,
	timestamp: number,
): AgentMetadata {
	const lastStepIndex = countSteps(request) + (session.lastExecutionId ? 1 : 0);
	const lower = model.toLowerCase();
	const isClaude = lower.startsWith('claude-');

	// These flags are sticky for the life of the conversation, not per-request.
	session.usedClaude = session.usedClaude === true || isClaude;
	session.usedNonGemini = session.usedNonGemini === true || isClaude || lower.startsWith('gpt-');

	const modelEnum = MODEL_ENUM[lower];

	return {
		requestId: `agent/${session.conversationId}/${timestamp}/${session.trajectoryId}/${lastStepIndex + 1}`,
		sessionId: session.numericSessionId,
		labels: {
			...(session.lastExecutionId ? { last_execution_id: session.lastExecutionId } : {}),
			last_step_index: String(lastStepIndex),
			...(modelEnum ? { model_enum: modelEnum } : {}),
			trajectory_id: session.trajectoryId,
			used_claude: session.usedClaude ? 'true' : 'false',
			used_claude_conservative: session.usedClaude ? 'true' : 'false',
			used_non_gemini_model: session.usedNonGemini ? 'true' : 'false',
		},
	};
}

/** Rewrites the object's keys into the order the client emits them. */
export function orderRequestFields(request: Record<string, unknown>): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	for (const key of REQUEST_FIELD_ORDER) {
		if (key in request) {
			ordered[key] = request[key];
		}
	}
	for (const key of Object.keys(request)) {
		if (!(key in ordered)) {
			ordered[key] = request[key];
		}
	}
	return ordered;
}

/** The outer envelope, in the field order the client emits. */
export function buildEnvelope(input: {
	project: string;
	model: string;
	request: Record<string, unknown>;
	requestId: string;
}): Record<string, unknown> {
	return {
		project: input.project,
		requestId: input.requestId,
		request: input.request,
		model: input.model,
		userAgent: 'antigravity',
		requestType: 'agent',
	};
}
