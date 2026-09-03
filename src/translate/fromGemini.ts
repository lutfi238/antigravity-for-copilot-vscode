import * as vscode from 'vscode';
import { ToolNameMap } from './schema';
import { SignatureCache, textKey } from './thinking';
import { GeminiCandidate, GeminiPart, GeminiUsage, GenerateContentResponse, USAGE_DATA_PART_MIME } from './types';

/**
 * VS Code ships `LanguageModelThinkingPart` at runtime but does not declare it in
 * `@types/vscode`, so it is reached through a widened view of the module and
 * feature-detected. When it is missing — older VS Code — reasoning falls back to a
 * markdown blockquote, which is the best a text-only stream can do.
 */
type VSCodeWithThinkingPart = typeof vscode & {
	LanguageModelThinkingPart?: new (
		value: string | string[],
		id?: string,
		metadata?: { readonly [key: string]: unknown },
	) => unknown;
};

export function createThinkingPart(
	value: string,
	id?: string,
): vscode.LanguageModelResponsePart | undefined {
	const ThinkingPart = (vscode as VSCodeWithThinkingPart).LanguageModelThinkingPart;
	if (typeof ThinkingPart !== 'function') {
		return undefined;
	}
	return new ThinkingPart(value, id) as vscode.LanguageModelResponsePart;
}

export function supportsThinkingPart(): boolean {
	return typeof (vscode as VSCodeWithThinkingPart).LanguageModelThinkingPart === 'function';
}

export interface EmitContext {
	names: ToolNameMap;
	signatures: SignatureCache;
	/** Surfaces the model's reasoning as chat text instead of discarding it. */
	showThinking: boolean;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
}

export interface EmitState {
	toolCallIndex: number;
	textBuffer: string;
	/** True while mid-blockquote, so the next answer token can close it. */
	thinkingOpen: boolean;
	/** Groups streamed reasoning chunks into a single collapsible block. */
	thinkingId: string;
	/**
	 * How many `thought: true` parts the stream actually carried. A model can report
	 * thought tokens in usage while returning no thought text at all, and without this
	 * the two cases are indistinguishable from outside.
	 */
	thoughtParts: number;
	finishReason?: string;
	usage?: GeminiUsage;
}

export function newEmitState(): EmitState {
	return {
		toolCallIndex: 0,
		textBuffer: '',
		thinkingOpen: false,
		thinkingId: `r${Date.now().toString(36)}`,
		thoughtParts: 0,
	};
}

/** Unwraps the gateway's `response` envelope, which is absent on some hosts. */
export function candidatesOf(chunk: GenerateContentResponse): GeminiCandidate[] {
	return chunk.response?.candidates ?? chunk.candidates ?? [];
}

export function usageOf(chunk: GenerateContentResponse): GeminiUsage | undefined {
	return chunk.response?.usageMetadata ?? chunk.usageMetadata;
}

/**
 * Converts gateway usage metadata into the private VS Code usage part.
 *
 * VS Code's context-window widget consumes a `LanguageModelDataPart` with the
 * reserved `usage` MIME type. The wire gateway uses camelCase Gemini names, while
 * the VS Code/Chat usage contract uses the OpenAI-shaped snake_case names below.
 */

export function createUsageDataPart(usage: GeminiUsage | undefined): vscode.LanguageModelDataPart | undefined {
	if (!usage) {
		return undefined;
	}

	const promptTokens = nonNegative(usage.promptTokenCount);
	// Gemini reports visible candidates and thinking tokens separately. Both count
	// against the context window, so expose their sum as completion_tokens, matching
	// VS Code's native Gemini provider.
	const completionTokens = nonNegative(usage.candidatesTokenCount) + nonNegative(usage.thoughtsTokenCount);
	const totalTokens = nonNegative(usage.totalTokenCount ?? promptTokens + completionTokens);

	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(
			JSON.stringify({
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: totalTokens,
				prompt_tokens_details: {
					cached_tokens: nonNegative(usage.cachedContentTokenCount),
				},
				completion_tokens_details: {
					reasoning_tokens: nonNegative(usage.thoughtsTokenCount),
				},
			}),
		),
		USAGE_DATA_PART_MIME,
	);
}

function nonNegative(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Converts one streamed chunk into VS Code response parts.
 *
 * Thought signatures are captured here rather than at the end of the stream because a
 * signature arrives attached to the part that carries it, and that association is what
 * makes it replayable on the next turn.
 */
export function emitChunk(chunk: GenerateContentResponse, context: EmitContext, state: EmitState): void {
	const usage = usageOf(chunk);
	if (usage) {
		// Streaming gateways may send an initial zero-valued usage object and fill in
		// fields on a later chunk. Keep the fields already observed.
		state.usage = { ...state.usage, ...usage };
	}

	for (const candidate of candidatesOf(chunk)) {
		if (candidate.finishReason) {
			state.finishReason = candidate.finishReason;
		}
		for (const part of candidate.content?.parts ?? []) {
			emitPart(part, context, state);
		}
	}
}

function emitPart(part: GeminiPart, context: EmitContext, state: EmitState): void {
	if (part.functionCall) {
		const name = context.names.resolve(part.functionCall.name);
		const callId = `${part.functionCall.name}__${state.toolCallIndex++}`;

		if (part.thoughtSignature) {
			context.signatures.set(callId, part.thoughtSignature);
		}

		context.progress.report(
			new vscode.LanguageModelToolCallPart(callId, name, part.functionCall.args ?? {}),
		);
		return;
	}

	if (typeof part.text !== 'string' || part.text.length === 0) {
		return;
	}

	if (part.thought) {
		state.thoughtParts++;
		if (!context.showThinking) {
			return;
		}

		// Preferred path: a real thinking part, which Copilot Chat renders as its own
		// collapsible "Thinking…" block. Streamed chunks share one id so they group
		// into a single block rather than one per token.
		const thinking = createThinkingPart(part.text, state.thinkingId);
		if (thinking) {
			context.progress.report(thinking);
			return;
		}

		// Fallback for VS Code builds without the thinking part: a markdown blockquote,
		// which at least reads as a distinct band rather than blending into the answer.
		if (!state.thinkingOpen) {
			state.thinkingOpen = true;
			context.progress.report(new vscode.LanguageModelTextPart('> 🧠 **Reasoning**\n>\n> '));
		}
		context.progress.report(new vscode.LanguageModelTextPart(part.text.replace(/\n/g, '\n> ')));
		return;
	}

	// First answer text after a reasoning run: close the quote block.
	if (state.thinkingOpen) {
		state.thinkingOpen = false;
		context.progress.report(new vscode.LanguageModelTextPart('\n\n'));
	}

	if (part.thoughtSignature) {
		state.textBuffer += part.text;
		context.signatures.set(textKey(state.textBuffer), part.thoughtSignature);
	} else {
		state.textBuffer += part.text;
	}

	context.progress.report(new vscode.LanguageModelTextPart(part.text));
}

/** Human-readable note appended when the model stopped for a non-obvious reason. */
export function finishNote(finishReason: string | undefined): string | undefined {
	switch (finishReason) {
		case 'MAX_TOKENS':
			return '\n\n_[Response truncated: the model hit its output token limit.]_';
		case 'OTHER':
			return '\n\n_[Response ended early. This usually means the request was filtered.]_';
		default:
			return undefined;
	}
}
