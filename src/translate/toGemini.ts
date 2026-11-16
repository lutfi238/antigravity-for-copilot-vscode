import * as vscode from 'vscode';
import { ModelSpec } from '../api/models';
import { emptySchema, sanitizeSchema, ToolNameMap } from './schema';
import { applyThinking, ReasoningEffort, SignatureCache, textKey } from './thinking';
import { GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequest, GeminiTool, USAGE_DATA_PART_MIME } from './types';
import { applyToolGuidance, TOOL_GUIDANCE_REVISION } from './toolGuidance';

/** Hosted markers owned by another provider must not be sent to Antigravity as functions. */
const INCOMPATIBLE_HOSTED_TOOL_NAMES = new Set(['codexForCopilot_searchWeb']);

export interface BuildOptions {
	model: ModelSpec;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools?: readonly vscode.LanguageModelChatTool[];
	toolMode: vscode.LanguageModelChatToolMode;
	modelOptions?: Record<string, unknown>;
	reasoningEffort: ReasoningEffort;
	/** Ask the model to return its reasoning. Off by default. */
	includeThoughts?: boolean;
	/** Advisory Gemini tool planning; opt-in at this boundary, configured by the provider. */
	efficientToolUse?: boolean;
	/**
	 * Forward the VS Code tool-call id on the wire. Gemini pairs calls to results by
	 * name, but the gateway's Gemini→Anthropic adapter needs a non-empty `tool_use.id`
	 * for Claude models, so this is on for Claude and off for Gemini by default.
	 */
	sendToolCallIds: boolean;
	signatures: SignatureCache;
}

export interface BuildResult {
	request: GeminiRequest;
	names: ToolNameMap;
	toolGuidance: typeof TOOL_GUIDANCE_REVISION | 'off';
	/** `inlineData` parts actually emitted, from both messages and tool results. */
	attachments: number;
}

export function buildRequest(options: BuildOptions): BuildResult {
	const names = new ToolNameMap();
	const { contents, attachments } = buildContents(
		options.messages,
		names,
		options.signatures,
		options.sendToolCallIds,
	);
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

	const toolGuidance = applyToolGuidance(request, options.model, options.efficientToolUse === true)
		? TOOL_GUIDANCE_REVISION : 'off';
	return { request, names, toolGuidance, attachments };
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
	sendToolCallIds: boolean,
): { contents: GeminiContent[]; attachments: number } {
	const callNames = new Map<string, string>();
	const contents: GeminiContent[] = [];
	// Counted here rather than by scanning the finished request: this is the exact
	// number of `inlineData` parts emitted, so the log can prove an image was attached
	// without inferring it from model behaviour.
	let attachments = 0;

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
					functionCall: {
						name: wireName,
						args: (item.input as Record<string, unknown>) ?? {},
						// Omit the key entirely when disabled so the payload stays byte-identical.
						...(sendToolCallIds && item.callId ? { id: item.callId } : {}),
					},
				};
				const signature = signatures.get(item.callId);
				if (signature) {
					part.thoughtSignature = signature;
				}
				parts.push(part);
			} else if (item instanceof vscode.LanguageModelToolResultPart) {
				// Gemini pairs a response to its call by name, and `response` is a protobuf
				// Struct: it only carries JSON values, so an image cannot live inside it.
				// Return the call plus any non-text payload as sibling parts so a screenshot
				// or generated image actually reaches the model instead of a byte-count stub.
				const { text, attachments: attachmentParts } = splitToolResult(item.content);
				resultParts.push({
					functionResponse: {
						name: callNames.get(item.callId) ?? item.callId,
						response: { output: text },
						...(sendToolCallIds && item.callId ? { id: item.callId } : {}),
					},
				});
				for (const attachment of attachmentParts) {
					resultParts.push({
						inlineData: {
							mimeType: attachment.mimeType,
							data: Buffer.from(attachment.data).toString('base64'),
						},
					});
					attachments++;
				}
			} else if (item instanceof vscode.LanguageModelDataPart) {
				// This is response metadata for VS Code's context widget, not model input.
				// Replaying it as inlineData would send an internal JSON blob to Gemini.
				if (item.mimeType.toLowerCase() === USAGE_DATA_PART_MIME) {
					continue;
				}
				parts.push({
					inlineData: {
						mimeType: item.mimeType,
						data: Buffer.from(item.data).toString('base64'),
					},
				});
				attachments++;
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

	return { contents, attachments };
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

/**
 * Separates a tool result into text for `functionResponse.response.output` and binary
 * attachments that must travel as `inlineData` parts.
 *
 * Text-like data is folded into the output string, matching how the gateway expects a
 * Struct. Anything else (images, audio, PDFs) is returned separately: embedding it as a
 * placeholder text would silently drop the payload, which breaks screenshot and
 * image-generation tool loops where the model needs to see what it just produced.
 */
function splitToolResult(content: ReadonlyArray<unknown>): {
	text: string;
	attachments: Array<{ mimeType: string; data: Uint8Array }>;
} {
	const chunks: string[] = [];
	const attachments: Array<{ mimeType: string; data: Uint8Array }> = [];
	for (const item of content) {
		if (item instanceof vscode.LanguageModelTextPart) {
			chunks.push(item.value);
		} else if (item instanceof vscode.LanguageModelDataPart) {
			if (item.mimeType.toLowerCase() === USAGE_DATA_PART_MIME) {
				continue;
			}
			if (item.mimeType.startsWith('text/') || item.mimeType.includes('json')) {
				chunks.push(Buffer.from(item.data).toString('utf8'));
			} else {
				attachments.push({ mimeType: item.mimeType, data: item.data });
			}
		} else if (typeof item === 'string') {
			chunks.push(item);
		}
	}
	// A tool that produced only an image still needs a non-empty output string.
	return { text: chunks.join('\n') || (attachments.length > 0 ? '(image attached)' : '(no output)'), attachments };
}

function buildTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
	names: ToolNameMap,
): GeminiTool | undefined {
	const compatibleTools = tools?.filter((tool) => !INCOMPATIBLE_HOSTED_TOOL_NAMES.has(tool.name));
	if (!compatibleTools || compatibleTools.length === 0) {
		return undefined;
	}

	const functionDeclarations = compatibleTools.map((tool) => ({
		name: names.register(tool.name),
		// The gateway requires a non-empty description.
		description: tool.description || tool.name,
		parameters: tool.inputSchema ? sanitizeSchema(tool.inputSchema) : emptySchema(),
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
