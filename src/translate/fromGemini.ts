import * as vscode from 'vscode';
import { ToolNameMap } from './schema';
import { SignatureCache, textKey } from './thinking';
import { GeminiCandidate, GeminiPart, GeminiUsage, GenerateContentResponse } from './types';

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
	finishReason?: string;
	usage?: GeminiUsage;
}

export function newEmitState(): EmitState {
	return { toolCallIndex: 0, textBuffer: '', thinkingOpen: false };
}

/** Unwraps the gateway's `response` envelope, which is absent on some hosts. */
export function candidatesOf(chunk: GenerateContentResponse): GeminiCandidate[] {
	return chunk.response?.candidates ?? chunk.candidates ?? [];
}

export function usageOf(chunk: GenerateContentResponse): GeminiUsage | undefined {
	return chunk.response?.usageMetadata ?? chunk.usageMetadata;
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
		state.usage = usage;
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
		// VS Code's provider API has no thinking part even at 1.134 — the response
		// stream is Text | ToolCall | ToolResult | Data. Third-party providers cannot
		// produce the collapsible "Thinking…" block Copilot's own models get, so the
		// best available option is a markdown blockquote, which at least renders as a
		// visually distinct band rather than blending into the answer.
		if (!context.showThinking) {
			return;
		}
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
