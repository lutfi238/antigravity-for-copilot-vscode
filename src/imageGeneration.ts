import * as vscode from 'vscode';
import { AgyImageRequest, runAgyImage } from './agyImage';

export const ANTIGRAVITY_IMAGE_GENERATION_TOOL_NAME = 'antigravity_generate_image';

type ImageGenerationInput = AgyImageRequest;

/** Converts validated sidecar output into the VS Code tool-result parts. */
export function createImageToolResult(result: Awaited<ReturnType<typeof runAgyImage>>): vscode.LanguageModelToolResult {
	const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [
		new vscode.LanguageModelTextPart(
			result.response?.trim() || `Generated ${result.images.length === 1 ? 'an image' : `${result.images.length} images`} with Antigravity.`,
		),
	];
	for (const image of result.images) {
		parts.push(vscode.LanguageModelDataPart.image(image.data, image.mimeType));
	}
	return new vscode.LanguageModelToolResult(parts);
}

/** Registers the Antigravity-native image generator as a Copilot tool. */
export function registerAntigravityImageGenerationTool(): vscode.Disposable {
	return vscode.lm.registerTool<ImageGenerationInput>(ANTIGRAVITY_IMAGE_GENERATION_TOOL_NAME, {
		prepareInvocation: () => ({
			invocationMessage: 'Generating an image with Antigravity…',
			confirmationMessages: {
				title: 'Generate an image with Antigravity?',
				message: 'This uses your Antigravity account and may consume image-generation quota.',
			},
		}),
		invoke: async (options, token) => {
			try {
				const result = await runAgyImage(options.input, token);
				return createImageToolResult(result);
			} catch (error) {
				if (error instanceof vscode.CancellationError) {
					throw error;
				}
				const message = error instanceof Error ? error.message : 'Unknown image-generation error.';
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Antigravity image generation failed: ${message}`),
				]);
			}
		},
	});
}
