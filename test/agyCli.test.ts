import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
	AGY_SEARCH_AGENT_PREFIX,
	AGY_SEARCH_MIN_VERSION,
	agySearchAgentDefinition,
	assertAgySearchAgentSupported,
	buildAgySearchArgs,
	buildAgySearchPrompt,
	createAgySearchWorkspace,
	parseAgySearchStream,
	runAgySearch,
	searchRunFailure,
} from '../src/agyCli';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async importOriginal => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	spawn: spawnMock,
}));

beforeEach(() => {
	spawnMock.mockReset();
});

describe('agyCli search bridge', () => {
	it('builds a single-tool search prompt without losing the query', () => {
		const prompt = buildAgySearchPrompt('latest Gemini updates');
		expect(prompt).toContain('Use the built-in search_web tool exactly once.');
		expect(prompt).toContain('Search query: "latest Gemini updates"');
		expect(prompt).toContain('Do not use any other tool');
	});

	it('defines an isolated custom agent whose runtime allowlist contains only search_web', async () => {
		const workspace = await createAgySearchWorkspace();
		try {
			expect(workspace.agentName).toMatch(new RegExp(`^${AGY_SEARCH_AGENT_PREFIX}-[a-f0-9]{12}$`));
			const definition = await fs.readFile(path.join(
				workspace.cwd, '.agents', 'agents', workspace.agentName, 'agent.md',
			), 'utf8');
			expect(definition).toBe(agySearchAgentDefinition(workspace.agentName));
			expect(definition).toContain(`name: ${workspace.agentName}`);
			expect(definition).toContain('mainAgent: true');
			expect(definition).toContain('subagent: false');
			expect(definition).toContain('tools:\n  - search_web');
			expect(definition).toContain('excludeDefaultComponents: true');
			expect(definition).toContain('inheritCustomizations: false');
			expect(definition).toContain('inheritMcp: false');
		} finally {
			await workspace.dispose();
		}
		await expect(fs.stat(workspace.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('uses a fresh agent name to avoid global custom-agent collisions', async () => {
		const first = await createAgySearchWorkspace();
		const second = await createAgySearchWorkspace();
		try {
			expect(first.agentName).not.toBe(second.agentName);
		} finally {
			await Promise.all([first.dispose(), second.dispose()]);
		}
	});

	it('accepts a successful stream only after native search_web ran', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { agent: 'isolated-test-agent', tools: ['search_web'] } }),
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'search_web',
					tool_info: { name: 'search_web', parameters: { query: 'Gemini' } },
				},
			}),
			JSON.stringify({
				event: 'result',
				result: { status: 'SUCCESS', response: '**Sources** https://example.com' },
			}),
		]);

		expect(result).toEqual({
			agentName: 'isolated-test-agent',
			status: 'SUCCESS',
			response: '**Sources** https://example.com',
			sawSearchWeb: true,
			searchCallCount: 1,
			unexpectedTools: [],
			malformedEvents: 0,
		});
		expect(searchRunFailure(result, 0)).toBeUndefined();
	});

	it('rejects a final success when the native search step failed', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'search_web',
					tool_info: { name: 'search_web', error: { message: '503 Service Unavailable' } },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'No source URLs.' } }),
		]);

		expect(result.sawSearchWeb).toBe(true);
		expect(result.toolError).toBe('503 Service Unavailable');
	});

	it('does not treat an unrelated tool as web search', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_type: 'tool', tool_name: 'read_url_content' },
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'fetched' } }),
		]);

		expect(result.sawSearchWeb).toBe(false);
		expect(result.status).toBe('SUCCESS');
	});

	it.each([
		{ stepType: 'tool', toolName: 'terminal' },
		{ stepType: 'subagent', toolName: 'invokeSubagent' },
	])('rejects a successful search that also used $toolName', ({ stepType, toolName }) => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' },
			}),
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 2, step_type: stepType, tool_name: toolName },
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.searchCallCount).toBe(1);
		expect(result.unexpectedTools).toEqual([toolName]);
		expect(searchRunFailure(result, 0)).toBe('Antigravity web search attempted an unexpected tool or subagent.');
	});

	it('rejects a transcript with malformed events instead of verifying only valid lines', () => {
		const result = parseAgySearchStream([
			'not-json',
			JSON.stringify({ event: 'init', init: { agent: 'isolated-test-agent', tools: ['search_web'] } }),
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.malformedEvents).toBe(1);
		expect(searchRunFailure(result, 0)).toBe('Antigravity web search stream could not be fully verified.');
	});

	it('rejects successful search output from anything but the expected isolated agent', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { agent: 'default', tools: ['search_web'] } }),
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(searchRunFailure(result, 0, 'isolated-expected')).toBe(
			'Antigravity CLI did not start the isolated Web Search agent.',
		);
	});

	it('unconditionally rejects output from the default agent even if expectedAgentName is omitted', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { agent: 'default', tools: ['search_web'] } }),
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(searchRunFailure(result, 0)).toBe(
			'Antigravity CLI executed the default agent instead of an isolated search.',
		);
	});

	it('extracts string errors and errorMessage fields on tool steps', () => {
		const resultStringError = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'search_web',
					tool_info: { name: 'search_web', error: '500 Internal Server Error' },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'No source URLs.' } }),
		]);
		expect(resultStringError.toolError).toBe('500 Internal Server Error');

		const resultErrorMessage = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_type: 'tool',
					tool_name: 'search_web',
					tool_info: { name: 'search_web', errorMessage: 'Quota exceeded for search' },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'No source URLs.' } }),
		]);
		expect(resultErrorMessage.toolError).toBe('Quota exceeded for search');
	});

	it('rejects unexpected fundamental component tools such as manage_task', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' },
			}),
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 2, step_type: 'tool', tool_name: 'manage_task' },
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.unexpectedTools).toEqual(['manage_task']);
		expect(searchRunFailure(result, 0)).toBe('Antigravity web search attempted an unexpected tool or subagent.');
	});

	it('parses camelCase stepUpdate and toolInfo from updated proto models', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { agentName: 'isolated-test-agent' } }),
			JSON.stringify({
				event: 'step_update',
				stepUpdate: {
					stepIndex: 1,
					stepType: 'tool',
					toolInfo: { toolName: 'search_web' },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.sawSearchWeb).toBe(true);
		expect(result.searchCallCount).toBe(1);
		expect(result.unexpectedTools).toEqual([]);
		expect(searchRunFailure(result, 0, 'isolated-test-agent')).toBeUndefined();
	});

	it('rejects when init event is missing or omits agent name', () => {
		const resultNoInit = parseAgySearchStream([
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);
		expect(searchRunFailure(resultNoInit, 0, 'isolated-expected')).toBe(
			'Antigravity CLI did not start the isolated Web Search agent.',
		);

		const resultNoAgent = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { tools: ['search_web'] } }),
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);
		expect(searchRunFailure(resultNoAgent, 0, 'isolated-expected')).toBe(
			'Antigravity CLI did not start the isolated Web Search agent.',
		);
	});

	it('rejects an empty or whitespace-only response', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { agent: 'isolated-test-agent', tools: ['search_web'] } }),
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '   \n  ' } }),
		]);
		expect(searchRunFailure(result, 0, 'isolated-test-agent')).toBe(
			'Antigravity web search returned no answer.',
		);
	});

	it('rejects when agy exits with a non-zero code even if result claimed SUCCESS', () => {
		const result = parseAgySearchStream([
			JSON.stringify({ event: 'init', init: { agent: 'isolated-test-agent', tools: ['search_web'] } }),
			JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } }),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);
		expect(searchRunFailure(result, 1, 'isolated-test-agent')).toBe(
			'Antigravity web search failed (exit 1).',
		);
		expect(searchRunFailure(result, null, 'isolated-test-agent')).toBe(
			'Antigravity web search failed.',
		);
	});

	it('rejects repeated native searches even when the final result succeeds', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' },
			}),
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 2, step_type: 'tool', tool_name: 'search_web' },
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.searchCallCount).toBe(2);
		expect(searchRunFailure(result, 0)).toContain('more than once');
	});

	it('counts status updates for one indexed search as a single invocation', () => {
		const result = parseAgySearchStream([
			JSON.stringify({
				event: 'step_update',
				step_update: { step_index: 7, step_type: 'tool', tool_name: 'search_web' },
			}),
			JSON.stringify({
				event: 'step_update',
				step_update: {
					step_index: 7,
					step_type: 'tool',
					tool_info: { name: 'search_web', output: { answer: 'Done.' } },
				},
			}),
			JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }),
		]);

		expect(result.searchCallCount).toBe(1);
		expect(result.unexpectedTools).toEqual([]);
		expect(searchRunFailure(result, 0)).toBeUndefined();
	});

	it('spawns agy with the restricted agent in its isolated workspace and cleans up', async () => {
		spawnMock.mockImplementation((_command, args) => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				if (args?.[0] === '--version') {
					child.stdout.end('1.4.5\n');
				} else {
					for (const event of [
						{ event: 'init', init: { agent: args?.[1], tools: ['search_web'] } },
						{ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'search_web' } },
						{ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'search_web' } },
						{ event: 'result', result: { status: 'SUCCESS', response: 'Grounded answer' } },
					]) child.stdout.write(`${JSON.stringify(event)}\n`);
					child.stdout.end();
				}
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(runAgySearch('latest Gemini updates', token)).resolves.toBe('Grounded answer');
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(spawnMock.mock.calls[0][1]).toEqual(['--version']);
		expect(spawnMock.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true });
		const [, args, options] = spawnMock.mock.calls[1];
		const agentName = args?.[1];
		expect(agentName).toMatch(new RegExp(`^${AGY_SEARCH_AGENT_PREFIX}-[a-f0-9]{12}$`));
		expect(args).toEqual(buildAgySearchArgs(buildAgySearchPrompt('latest Gemini updates'), agentName));
		expect(args).not.toContain('--dangerously-skip-permissions');
		expect(options).toMatchObject({ shell: false, windowsHide: true });
		expect(options.env).toMatchObject({ PWD: options.cwd, OLDPWD: options.cwd });
		expect(options.cwd).toContain('antigravity-copilot-search-');
		expect(options.cwd).not.toBe(process.cwd());
		await expect(fs.stat(options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('rejects and cleans up when agy starts any agent other than the isolated one', async () => {
		spawnMock.mockImplementation((_command, args) => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				if (args?.[0] === '--version') {
					child.stdout.end('1.4.5\n');
				} else {
					for (const event of [
						{ event: 'init', init: { agent: 'default', tools: ['search_web', 'run_command'] } },
						{ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web' } },
						{ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } },
					]) child.stdout.write(`${JSON.stringify(event)}\n`);
					child.stdout.end();
				}
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(runAgySearch('query', token)).rejects.toThrow(
			'Antigravity CLI did not start the isolated Web Search agent.',
		);
		const workspace = spawnMock.mock.calls[1][2].cwd;
		await expect(fs.stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('aborts and cleans up when search output exceeds the verification limit', async () => {
		spawnMock.mockImplementation((_command, args) => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn(() => setImmediate(() => child.emit('close', null)));
			setImmediate(() => {
				if (args?.[0] === '--version') {
					child.stdout.end('1.4.5\n');
					setImmediate(() => child.emit('close', 0));
				} else {
					child.stdout.write(`${'x'.repeat(256 * 1024 + 1)}\n`);
				}
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(runAgySearch('query', token)).rejects.toThrow('exceeded the output limit');
		const workspace = spawnMock.mock.calls[1][2].cwd;
		await expect(fs.stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('rejects an older agy before creating a search turn', async () => {
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				child.stdout.end('1.3.3\n');
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(runAgySearch('query', token)).rejects.toThrow(`requires agy ${AGY_SEARCH_MIN_VERSION} or newer`);
		expect(spawnMock).toHaveBeenCalledOnce();
		expect(spawnMock.mock.calls[0][1]).toEqual(['--version']);
	});

	it('cleans up workspace and rejects when search process emits ENOENT', async () => {
		spawnMock.mockImplementation((_command, args) => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				if (args?.[0] === '--version') {
					child.stdout.end('1.4.5\n');
					setImmediate(() => child.emit('close', 0));
				} else {
					const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
					err.code = 'ENOENT';
					child.emit('error', err);
				}
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(runAgySearch('query', token)).rejects.toThrow('Antigravity CLI was not found');
		expect(spawnMock).toHaveBeenCalledTimes(2);
		const workspace = spawnMock.mock.calls[1][2].cwd;
		await expect(fs.stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('does not spawn a search when cancellation arrives during workspace creation', async () => {
		let cancelled = false;
		let createdWorkspace: string | undefined;
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				child.stdout.end('1.4.5\n');
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			get isCancellationRequested() { return cancelled; },
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(runAgySearch('query', token, async () => {
			const workspace = await createAgySearchWorkspace();
			createdWorkspace = workspace.cwd;
			cancelled = true;
			return workspace;
		})).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(spawnMock).toHaveBeenCalledOnce();
		expect(createdWorkspace).toBeDefined();
		await expect(fs.stat(createdWorkspace!)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('cleans up the temporary workspace when cancellation terminates a running search', async () => {
		let cancellation: (() => void) | undefined;
		let cancelled = false;
		spawnMock.mockImplementation((_command, args) => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn(() => setImmediate(() => child.emit('close', null)));
			setImmediate(() => {
				if (args?.[0] === '--version') {
					child.stdout.end('1.4.5\n');
					setImmediate(() => child.emit('close', 0));
				}
			});
			return child;
		});
		const token: vscode.CancellationToken = {
			get isCancellationRequested() { return cancelled; },
			onCancellationRequested: (listener: () => void) => {
				cancellation = listener;
				return { dispose() {} };
			},
		};

		const pending = runAgySearch('query', token);
		await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
		const workspace = spawnMock.mock.calls[1][2].cwd;
		cancelled = true;
		cancellation?.();

		await expect(pending).rejects.toBeInstanceOf(vscode.CancellationError);
		await expect(fs.stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('throws CancellationError immediately if token is pre-cancelled', async () => {
		const token: vscode.CancellationToken = {
			isCancellationRequested: true,
			onCancellationRequested: () => ({ dispose() {} }),
		};
		await expect(runAgySearch('query', token)).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(spawnMock).not.toHaveBeenCalled();
	});
});

describe('assertAgySearchAgentSupported', () => {
	const dummyToken: vscode.CancellationToken = {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	};

	it.each([
		['1.3.4\n', '1.3.4'],
		['1.4.5\n', '1.4.5'],
		['v1.4.0\n', 'v1.4.0'],
		['agy 1.4.7\n', 'agy 1.4.7'],
		['Warning: update\n1.4.5\n', 'multiline with warning banner'],
	])('accepts supported version output: %s (%s)', async (versionOutput) => {
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				child.stdout.end(versionOutput);
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});

		await expect(assertAgySearchAgentSupported('agy', dummyToken)).resolves.toBeUndefined();
	});

	it('accepts version output written to stderr instead of stdout', async () => {
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				child.stderr.end('1.4.5\n');
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});

		await expect(assertAgySearchAgentSupported('agy', dummyToken)).resolves.toBeUndefined();
	});

	it.each([
		['1.3.3\n', '1.3.3'],
		['1.2.1\n', '1.2.1'],
		['0.9.0\n', '0.9.0'],
		['invalid\n', 'unparseable'],
		['\n', 'empty'],
	])('rejects unsupported or unparseable version output: %s (%s)', async (versionOutput) => {
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				child.stdout.end(versionOutput);
				setImmediate(() => child.emit('close', 0));
			});
			return child;
		});

		await expect(assertAgySearchAgentSupported('agy', dummyToken)).rejects.toThrow(
			`requires agy ${AGY_SEARCH_MIN_VERSION} or newer`,
		);
	});

	it('rejects when agy --version exits with non-zero exit code', async () => {
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				child.stdout.end('1.4.5\n');
				setImmediate(() => child.emit('close', 1));
			});
			return child;
		});

		await expect(assertAgySearchAgentSupported('agy', dummyToken)).rejects.toThrow(
			`requires agy ${AGY_SEARCH_MIN_VERSION} or newer`,
		);
	});

	it('rejects with descriptive error when agy binary is missing (ENOENT)', async () => {
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as any;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			setImmediate(() => {
				const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
				err.code = 'ENOENT';
				child.emit('error', err);
			});
			return child;
		});

		await expect(assertAgySearchAgentSupported('agy', dummyToken)).rejects.toThrow(
			'Antigravity CLI was not found at "agy"',
		);
	});

	it('rejects immediately without spawning if token is pre-cancelled', async () => {
		const token: vscode.CancellationToken = {
			isCancellationRequested: true,
			onCancellationRequested: () => ({ dispose() {} }),
		};

		await expect(assertAgySearchAgentSupported('agy', token)).rejects.toBeInstanceOf(
			vscode.CancellationError,
		);
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
