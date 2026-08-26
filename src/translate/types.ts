/** Gemini-shaped wire types. The gateway speaks this dialect for every model family. */

export interface GeminiPart {
	text?: string;
	/** Marks reasoning output rather than answer text. */
	thought?: boolean;
	/** Opaque token Gemini 3 requires to be echoed back on later turns. */
	thoughtSignature?: string;
	functionCall?: { name: string; args?: Record<string, unknown> };
	functionResponse?: { name: string; response: Record<string, unknown> };
	inlineData?: { mimeType: string; data: string };
}

export interface GeminiContent {
	/** `user` or `model` — never `assistant`. */
	role: 'user' | 'model';
	parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
	name: string;
	description: string;
	parameters?: unknown;
}

export interface GeminiTool {
	functionDeclarations?: GeminiFunctionDeclaration[];
}

export interface GeminiGenerationConfig {
	maxOutputTokens?: number;
	temperature?: number;
	topP?: number;
	topK?: number;
	stopSequences?: string[];
	/** Gemini 3 takes `thinkingLevel`; Claude takes a numeric `thinkingBudget`. */
	thinkingConfig?: {
		thinkingBudget?: number;
		thinkingLevel?: 'low' | 'medium' | 'high';
		includeThoughts?: boolean;
	};
}

export interface GeminiRequest {
	contents: GeminiContent[];
	/** Must be an object with `parts`; a bare string is rejected with a 400. */
	systemInstruction?: { parts: GeminiPart[] };
	tools?: GeminiTool[];
	toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE' } };
	generationConfig?: GeminiGenerationConfig;
}

export interface GenerateContentBody {
	project: string;
	model: string;
	request: GeminiRequest;
	userAgent?: string;
	requestId?: string;
}

export interface GeminiCandidate {
	content?: GeminiContent;
	finishReason?: 'STOP' | 'MAX_TOKENS' | 'OTHER' | string;
}

export interface GeminiUsage {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	thoughtsTokenCount?: number;
	totalTokenCount?: number;
}

export interface GenerateContentResponse {
	/** The gateway nests the model response under `response`. */
	response?: {
		candidates?: GeminiCandidate[];
		usageMetadata?: GeminiUsage;
		responseId?: string;
	};
	candidates?: GeminiCandidate[];
	usageMetadata?: GeminiUsage;
}
