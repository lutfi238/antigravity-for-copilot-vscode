/**
 * Minimal stand-in for the `vscode` module so the translation layer can be unit tested
 * outside an extension host. Only the constructs the translators actually touch are
 * implemented — instanceof checks and enum values.
 */

export class LanguageModelTextPart {
	constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
	constructor(
		public callId: string,
		public name: string,
		public input: object,
	) {}
}

export class LanguageModelToolResultPart {
	constructor(
		public callId: string,
		public content: unknown[],
	) {}
}

export class LanguageModelDataPart {
	constructor(
		public data: Uint8Array,
		public mimeType: string,
	) {}
}

export class LanguageModelPromptTsxPart {
	constructor(public value: unknown) {}
}

export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
}

export enum LanguageModelChatToolMode {
	Auto = 1,
	Required = 2,
}

export class CancellationError extends Error {}

export class LanguageModelError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
	}
	static NoPermissions(message?: string) {
		return new LanguageModelError(message ?? '', 'NoPermissions');
	}
	static Blocked(message?: string) {
		return new LanguageModelError(message ?? '', 'Blocked');
	}
	static NotFound(message?: string) {
		return new LanguageModelError(message ?? '', 'NotFound');
	}
}

export const window = {
	createOutputChannel: () => ({
		trace() {},
		debug() {},
		info() {},
		warn() {},
		error() {},
		show() {},
		dispose() {},
	}),
};

export const workspace = {
	getConfiguration: () => ({ get: () => undefined }),
};

/** Present at runtime in VS Code but absent from @types/vscode. */
export class LanguageModelThinkingPart {
	constructor(
		public value: string | string[],
		public id?: string,
		public metadata?: { readonly [key: string]: unknown },
	) {}
}
