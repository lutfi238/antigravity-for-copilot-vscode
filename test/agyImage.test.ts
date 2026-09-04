import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildAgyImagePrompt,
	detectImageMime,
	findRecentRasterFiles,
	isTrustedAgyArtifactPath,
	imageReferencePath,
	parseAgyImageStream,
} from '../src/agyImage';
import { createImageToolResult } from '../src/imageGeneration';
import * as vscode from 'vscode';

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('agy image bridge', () => {
	it('builds a confined single-tool image prompt', () => {
		const prompt = buildAgyImagePrompt({ prompt: 'A red fox in a snowy forest', aspectRatio: '16:9' });
		expect(prompt).toContain('Use the built-in generate_image tool exactly once.');
		expect(prompt).toContain('<image_prompt>\nA red fox in a snowy forest\n</image_prompt>');
		expect(prompt).toContain('set its AspectRatio argument to "16:9".');
		expect(prompt).toContain('Do not use any other tool');
	});

	it('extracts the observed generateImage outputPath shape', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'generate_image',
					tool_info: {
						name: 'generate_image',
						result: {
							generateImage: {
								outputPath: 'file:///C:/Users/test/.gemini/antigravity-cli/brain/c1/cat.jpg',
							},
						},
					},
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.sawGenerateImage).toBe(true);
		expect(result.imagePaths).toEqual(['file:///C:/Users/test/.gemini/antigravity-cli/brain/c1/cat.jpg']);
		expect(result.status).toBe('SUCCESS');
	});

	it('captures the CLI conversation id from the init event', () => {
		const result = parseAgyImageStream([
			JSON.stringify({ event: 'init', conversation_id: '6d52a886-dcb6-4714-955f-dd6a27af3630', init: { tools: ['generate_image'] } }),
		]);

		expect(result.conversationId).toBe('6d52a886-dcb6-4714-955f-dd6a27af3630');
	});

	it('accepts camelCase proto-derived stream keys', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				stepUpdate: {
					stepType: 'generateImage',
					generateImage: {
						outputPath: 'file:///C:/Users/test/.gemini/antigravity/brain/c1/cat.jpg',
					},
				},
			}),
		]);

		expect(result.sawGenerateImage).toBe(true);
		expect(result.imagePaths).toEqual(['file:///C:/Users/test/.gemini/antigravity/brain/c1/cat.jpg']);
	});

	it('parses a JSON-encoded artifact payload', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'generate_image',
					tool_info: {
						name: 'generate_image',
						result: JSON.stringify({ outputPath: 'file:///C:/image.jpg' }),
					},
				},
			}),
		]);

		expect(result.imagePaths).toEqual(['file:///C:/image.jpg']);
	});

	it('parses the documented tool_info.output field', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'generate_image',
					tool_info: {
						name: 'generate_image',
						parameters: { Prompt: 'a cat' },
						output: JSON.stringify({ image_name: 'cat', aspect_ratio: '1:1', output_path: 'C:/Users/test/.gemini/antigravity-cli/brain/cat.jpg' }),
					},
				},
			}),
		]);

		expect(result.imagePaths).toEqual(['C:/Users/test/.gemini/antigravity-cli/brain/cat.jpg']);
	});

	it('finds a platform path with spaces in plain tool output', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'generate_image',
					tool_info: {
						name: 'generate_image',
						output: 'Saved to C:\\Users\\test user\\.gemini\\antigravity-cli\\brain\\cat image.jpg.',
					},
				},
			}),
		]);

		expect(result.imagePaths).toEqual(['C:\\Users\\test user\\.gemini\\antigravity-cli\\brain\\cat image.jpg']);
	});

	it('collects artifacts when the terminal result carries the image payload', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_type: 'tool', tool_name: 'generate_image' },
			}),
			JSON.stringify({
				event: 'result',
				result: {
					status: 'SUCCESS',
					generateImage: { image_paths: ['file:///C:/image.jpg'] },
				},
			}),
		]);

		expect(result.imagePaths).toEqual(['file:///C:/image.jpg']);
	});

	it('extracts imagePaths arrays and validated inline image data', () => {
		const encoded = Buffer.from(PNG_HEADER).toString('base64');
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_info: {
						name: 'generate_image',
						output: { imagePaths: ['/tmp/not-used.png'], image: { data: `data:image/png;base64,${encoded}` } },
					},
				},
			}),
		]);

		expect(result.imagePaths).toEqual(['/tmp/not-used.png']);
		expect(result.inlineImages).toHaveLength(1);
		expect(result.inlineImages[0]).toEqual(PNG_HEADER);
	});

	it('does not collect input image paths from tool parameters', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'generate_image',
					tool_info: {
						name: 'generate_image',
						parameters: { imagePaths: ['C:/private/secret.png'] },
					},
				},
			}),
		]);

		expect(result.sawGenerateImage).toBe(true);
		expect(result.imagePaths).toEqual([]);
	});

	it('does not treat native action input image_paths as generated output', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					generate_image: {
						image_paths: ['C:/Users/test/.gemini/antigravity-cli/brain/input.png'],
						output_path: 'C:/Users/test/.gemini/antigravity-cli/brain/output.jpg',
					},
				},
			}),
		]);

		expect(result.imagePaths).toEqual(['C:/Users/test/.gemini/antigravity-cli/brain/output.jpg']);
	});

	it('rejects an image turn that attempted another tool', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_type: 'tool', tool_name: 'run_command' },
			}),
			JSON.stringify({
				event: 'step_update',
				step_update: { step_type: 'tool', tool_name: 'generate_image', tool_info: { name: 'generate_image' } },
			}),
		]);

		expect(result.unexpectedTools).toEqual(['run_command']);
		expect(result.sawGenerateImage).toBe(true);
	});

	it('captures native tool errors even when the terminal result says success', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'generate_image',
					tool_info: { name: 'generate_image', error: { message: '503 Service Unavailable' } },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.toolError).toBe('503 Service Unavailable');
	});

	it('retains a terminal error even when its status is incorrectly success', () => {
		const result = parseAgyImageStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_type: 'tool', tool_name: 'generate_image' },
			}),
			JSON.stringify({
				event: 'result',
				result: { status: 'SUCCESS', error: { message: 'generation failed' } },
			}),
		]);

		expect(result.error).toBe('generation failed');
	});

	it('recognizes safe raster signatures only', () => {
		expect(detectImageMime(PNG_HEADER)).toBe('image/png');
		expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(detectImageMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
		expect(detectImageMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
		expect(detectImageMime(Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))).toBeUndefined();
	});

	it('rejects relative artifact references', () => {
		expect(imageReferencePath('relative/cat.png')).toBeUndefined();
		expect(imageReferencePath('')).toBeUndefined();
		expect(imageReferencePath('file:///C:/Users/test/cat.png')).toMatch(/cat\.png$/i);
		expect(imageReferencePath('/Users/test/.gemini/antigravity/brain/cat.png')).toMatch(/cat\.png$/i);
		expect(imageReferencePath('~/cat.png')).toMatch(/cat\.png$/i);
	});

	it('limits artifact reads to Antigravity brain directories', () => {
		expect(isTrustedAgyArtifactPath('C:/Users/test/.gemini/antigravity-cli/brain/run/cat.png')).toBe(false);
		expect(isTrustedAgyArtifactPath('relative/.gemini/antigravity-cli/brain/cat.png')).toBe(false);
	});

	it('returns text plus inline VS Code image parts', () => {
		const result = createImageToolResult({
			response: 'Generated successfully.',
			images: [{ data: PNG_HEADER, mimeType: 'image/png' }],
		});

		expect(result.content).toHaveLength(2);
		expect(result.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
		expect(result.content[1]).toBeInstanceOf(vscode.LanguageModelDataPart);
		expect((result.content[1] as vscode.LanguageModelDataPart).mimeType).toBe('image/png');
	});

	it('finds a recent raster artifact when the stream omits output_path', async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-image-test-'));
		try {
			const imagePath = path.join(directory, 'antigravity_copilot_image_1.jpg');
			await fs.writeFile(imagePath, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
			await fs.writeFile(path.join(directory, 'notes.txt'), 'not an image');
			const found = await findRecentRasterFiles(directory, Date.now() - 5_000, [directory]);

			expect(found).toEqual([imagePath]);
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
});
