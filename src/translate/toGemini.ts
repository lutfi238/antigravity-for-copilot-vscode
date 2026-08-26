import * as vscode from 'vscode';
import { ModelSpec } from '../api/models';
import { sanitizeSchema, ToolNameMap } from './schema';
import { applyThinking, ReasoningEffort, SignatureCache, textKey } from './thinking';
import { GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequest, GeminiTool } from './types';

export interface BuildOptions {
	model: ModelSpec;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools?: readonly vscode.LanguageModelChatTool[];
	toolMode: vscode.LanguageModelChatToolMode;
	modelOptions?: Record<string, unknown>;
	reasoningEffort: ReasoningEffort;
	/** Ask the model to return its reasoning. Off by default. */
	includeThoughts?: boolean;
	signatures: SignatureCache;
}

export interface BuildResult {
	request: GeminiRequest;
	names: ToolNameMap;
}

export function buildRequest(options: BuildOptions): BuildResult {
	const names = new ToolNameMap();
	const contents = buildContents(options.messages, names, options.signatures);
	const request: GeminiRequest = { contents };

	const tools = buildTools(options.tools, names);
	if (tools) {
		request.tools = [tools];
		request.toolConfig = {
			functionCallingConfig: {
				mode: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'ANY' : 'AUTO',
			},
		};
	}

	let generationConfig = pickGenerationConfig(options.modelOptions, options.model);
	generationConfig = applyThinking(
		generationConfig,
		options.model,
		options.reasoningEffort,
		options.includeThoughts === true,
	);
	if (Object.keys(generationConfig).length > 0) {
		request.generationConfig = generationConfig;
	}

	return { request, names };
}

/**
 * Walks VS Code's flat message list into Gemini `contents`.
 *
 * The walk is single-pass and order-dependent for a reason: a tool call always
 * precedes its result, so recording `callId → toolName` on the way past the call lets
 * us name the `functionResponse` correctly when the result arrives. Gemini matches
 * responses to calls by name, not by id, so this mapping is not optional.
 */
function buildContents(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	names: ToolNameMap,
	signatures: SignatureCache,
): GeminiContent[] {
	const callNames = new Map<string, string>();
	const contents: GeminiContent[] = [];

	for (const message of messages) {
		const role: 'user' | 'model' =
			message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'model' : 'user';
		const parts: GeminiPart[] = [];
		// A tool result is logically a user turn even when VS Code files it elsewhere.
		const resultParts: GeminiPart[] = [];

		for (const item of message.content) {
			if (item instanceof vscode.LanguageModelTextPart) {
				if (!item.value) {
					continue;
				}
				const part: GeminiPart = { text: item.value };
				if (role === 'model') {
					const signature = signatures.get(textKey(item.value));
					if (signature) {
						part.thoughtSignature = signature;
					}
				}
				parts.push(part);
			} else if (item instanceof vscode.LanguageModelToolCallPart) {
				const wireName = names.register(item.name);
				callNames.set(item.callId, wireName);
				const part: GeminiPart = {
					functionCall: { name: wireName, args: (item.input as Record<string, unknown>) ?? {} },
				};
				const signature = signatures.get(item.callId);
				if (signature) {
					part.thoughtSignature = signature;
				}
				parts.push(part);
			} else if (item instanceof vscode.LanguageModelToolResultPart) {
				resultParts.push({
					functionResponse: {
						name: callNames.get(item.callId) ?? item.callId,
						response: { output: flattenToolResult(item.content) },
					},
				});
			} else if (item instanceof vscode.LanguageModelDataPart) {
				parts.push({
					inlineData: {
						mimeType: item.mimeType,
						data: Buffer.from(item.data).toString('base64'),
					},
				});
			}
		}

		if (parts.length > 0) {
			append(contents, role, parts);
		}
		if (resultParts.length > 0) {
			append(contents, 'user', resultParts);
		}
	}

	// Gemini expects the conversation to open with a user turn.
	if (contents.length > 0 && contents[0].role === 'model') {
		contents.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
	}

	return contents;
}

/** Merges into the previous content block when the role matches. */
function append(contents: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]): void {
	const last = contents[contents.length - 1];
	if (last && last.role === role) {
		last.parts.push(...parts);
		return;
	}
	contents.push({ role, parts });
}

function flattenToolResult(content: ReadonlyArray<unknown>): string {
	const chunks: string[] = [];
	for (const item of content) {
		if (item instanceof vscode.LanguageModelTextPart) {
			chunks.push(item.value);
		} else if (item instanceof vscode.LanguageModelDataPart) {
			if (item.mimeType.startsWith('text/') || item.mimeType.includes('json')) {
				chunks.push(Buffer.from(item.data).toString('utf8'));
			} else {
				chunks.push(`[${item.mimeType}, ${item.data.length} bytes]`);
			}
		} else if (typeof item === 'string') {
			chunks.push(item);
		}
	}
	return chunks.join('\n') || '(no output)';
}

function buildTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
	names: ToolNameMap,
): GeminiTool | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const functionDeclarations = tools.map((tool) => ({
		name: names.register(tool.name),
		// The gateway requires a non-empty description.
		description: tool.description || tool.name,
		parameters: tool.inputSchema ? sanitizeSchema(tool.inputSchema) : { type: 'OBJECT', properties: {} },
	}));

	return { functionDeclarations };
}

function pickGenerationConfig(
	modelOptions: Record<string, unknown> | undefined,
	model: ModelSpec,
): GeminiGenerationConfig {
	const config: GeminiGenerationConfig = { maxOutputTokens: model.maxOutputTokens };
	if (!modelOptions) {
		return config;
	}
	if (typeof modelOptions.maxOutputTokens === 'number') {
		config.maxOutputTokens = Math.min(modelOptions.maxOutputTokens, model.maxOutputTokens);
	}
	if (typeof modelOptions.temperature === 'number') {
		config.temperature = modelOptions.temperature;
	}
	if (typeof modelOptions.topP === 'number') {
		config.topP = modelOptions.topP;
	}
	if (typeof modelOptions.topK === 'number') {
		config.topK = modelOptions.topK;
	}
	if (Array.isArray(modelOptions.stopSequences)) {
		config.stopSequences = modelOptions.stopSequences.filter((s): s is string => typeof s === 'string');
	}
	return config;
}
