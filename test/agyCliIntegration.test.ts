import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { config } from '../src/config';
import { AGY_SEARCH_AGENT_PREFIX, AGY_SEARCH_MIN_VERSION, runAgySearch } from '../src/agyCli';

const dummyToken: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
};

describe('agyCli integration with fake agy binary', () => {
	let tempDir: string;
	let fakeAgyPath: string;
	let logPath: string;

	beforeAll(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-fake-agy-'));
		logPath = path.join(tempDir, 'fake-agy-calls.log');
		process.env.FAKE_AGY_LOG = logPath;

		try {
			if (process.platform === 'win32') {
				const root = process.env.SystemRoot || 'C:\\Windows';
				const csc = [
					path.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
					path.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
				].find(candidate => fs.existsSync(candidate));

				fakeAgyPath = path.join(tempDir, 'fake-agy.exe');
				if (csc) {
					const csSource = path.join(tempDir, 'FakeAgy.cs');
					const code = `
using System;
using System.IO;

class Program {
    static int Main(string[] args) {
        string logFile = Environment.GetEnvironmentVariable("FAKE_AGY_LOG");
        if (!string.IsNullOrEmpty(logFile)) {
            File.AppendAllText(logFile, "CALL: " + string.Join(" ", args).Replace("\\r", "").Replace("\\n", "\\\\n") + "\\n");
        }
        if (args.Length > 0 && args[0] == "--version") {
            string ver = Environment.GetEnvironmentVariable("FAKE_AGY_VERSION");
            Console.WriteLine(string.IsNullOrEmpty(ver) ? "1.3.3" : ver);
            return 0;
        }
        string mode = Environment.GetEnvironmentVariable("FAKE_AGY_MODE");
        if (mode == "spoof_default") {
            Console.WriteLine("{\\"event\\":\\"init\\",\\"init\\":{\\"agent\\":\\"default\\",\\"tools\\":[\\"search_web\\",\\"run_command\\"]}}");
            Console.WriteLine("{\\"event\\":\\"step_update\\",\\"step_update\\":{\\"step_type\\":\\"tool\\",\\"tool_name\\":\\"search_web\\"}}");
            Console.WriteLine("{\\"event\\":\\"result\\",\\"result\\":{\\"status\\":\\"SUCCESS\\",\\"response\\":\\"Default result\\"}}");
            return 0;
        }
        string agentName = (args.Length > 1 && args[0] == "--agent") ? args[1] : "default";
        Console.WriteLine("{\\"event\\":\\"init\\",\\"init\\":{\\"agent\\":\\"" + agentName + "\\",\\"tools\\":[\\"search_web\\"]}}");
        Console.WriteLine("{\\"event\\":\\"step_update\\",\\"step_update\\":{\\"step_index\\":1,\\"step_type\\":\\"tool\\",\\"tool_name\\":\\"search_web\\",\\"tool_info\\":{\\"name\\":\\"search_web\\"}}}");
        Console.WriteLine("{\\"event\\":\\"result\\",\\"result\\":{\\"status\\":\\"SUCCESS\\",\\"response\\":\\"Grounded search answer\\"}}");
        return 0;
    }
}
`;
					fs.writeFileSync(csSource, code, 'utf8');
					execFileSync(csc, ['/nologo', `/out:${fakeAgyPath}`, csSource]);
				} else {
					// Fallback to gcc on Windows if .NET csc is absent
					const cSource = path.join(tempDir, 'FakeAgy.c');
					const cCode = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    char *logFile = getenv("FAKE_AGY_LOG");
    if (logFile) {
        FILE *f = fopen(logFile, "a");
        if (f) {
            fprintf(f, "CALL: ");
            for (int i = 1; i < argc; i++) {
                char *arg = argv[i];
                for (int j = 0; arg[j]; j++) {
                    if (arg[j] == '\\r') continue;
                    if (arg[j] == '\\n') fputs("\\\\n", f);
                    else fputc(arg[j], f);
                }
                fputc(' ', f);
            }
            fprintf(f, "\\n");
            fclose(f);
        }
    }
    if (argc > 1 && strcmp(argv[1], "--version") == 0) {
        char *ver = getenv("FAKE_AGY_VERSION");
        printf("%s\\n", ver ? ver : "1.3.3");
        return 0;
    }
    char *mode = getenv("FAKE_AGY_MODE");
    if (mode && strcmp(mode, "spoof_default") == 0) {
        printf("{\\"event\\":\\"init\\",\\"init\\":{\\"agent\\":\\"default\\",\\"tools\\":[\\"search_web\\",\\"run_command\\"]}}\\n");
        printf("{\\"event\\":\\"step_update\\",\\"step_update\\":{\\"step_type\\":\\"tool\\",\\"tool_name\\":\\"search_web\\"}}\\n");
        printf("{\\"event\\":\\"result\\",\\"result\\":{\\"status\\":\\"SUCCESS\\",\\"response\\":\\"Default result\\"}}\\n");
        return 0;
    }
    char *agentName = (argc > 2 && strcmp(argv[1], "--agent") == 0) ? argv[2] : "default";
    printf("{\\"event\\":\\"init\\",\\"init\\":{\\"agent\\":\\"%s\\",\\"tools\\":[\\"search_web\\"]}}\\n", agentName);
    printf("{\\"event\\":\\"step_update\\",\\"step_update\\":{\\"step_index\\":1,\\"step_type\\":\\"tool\\",\\"tool_name\\":\\"search_web\\",\\"tool_info\\":{\\"name\\":\\"search_web\\"}}}\\"\\n");
    printf("{\\"event\\":\\"result\\",\\"result\\":{\\"status\\":\\"SUCCESS\\",\\"response\\":\\"Grounded search answer\\"}}\\n");
    return 0;
}
`;
					fs.writeFileSync(cSource, cCode, 'utf8');
					execFileSync('gcc', ['-o', fakeAgyPath, cSource]);
				}
			} else {
				fakeAgyPath = path.join(tempDir, 'fake-agy');
				const script = `#!${process.execPath}
const fs = require('node:fs');
const logFile = process.env.FAKE_AGY_LOG;
const args = process.argv.slice(2);
if (logFile) {
    fs.appendFileSync(logFile, 'CALL: ' + args.join(' ').replace(/\\r/g, '').replace(/\\n/g, '\\\\n') + '\\n');
}
if (args[0] === '--version') {
    console.log(process.env.FAKE_AGY_VERSION || '1.3.3');
    process.exit(0);
}
const mode = process.env.FAKE_AGY_MODE;
if (mode === 'spoof_default') {
    console.log(JSON.stringify({ event: 'init', init: { agent: 'default', tools: ['search_web', 'run_command'] } }));
    console.log(JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'search_web' } }));
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Default result' } }));
    process.exit(0);
}
const agentName = (args.length > 1 && args[0] === '--agent') ? args[1] : 'default';
console.log(JSON.stringify({ event: 'init', init: { agent: agentName, tools: ['search_web'] } }));
console.log(JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'search_web', tool_info: { name: 'search_web' } } }));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Grounded search answer' } }));
`;
				fs.writeFileSync(fakeAgyPath, script, { mode: 0o755 });
			}
		} catch (error) {
			fs.rmSync(tempDir, { recursive: true, force: true });
			throw error;
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.FAKE_AGY_VERSION;
		delete process.env.FAKE_AGY_MODE;
		if (logPath && fs.existsSync(logPath)) {
			try {
				fs.unlinkSync(logPath);
			} catch {
				// Best effort on file locks
			}
		}
	});

	afterAll(() => {
		vi.restoreAllMocks();
		delete process.env.FAKE_AGY_LOG;
		delete process.env.FAKE_AGY_VERSION;
		delete process.env.FAKE_AGY_MODE;
		if (tempDir && fs.existsSync(tempDir)) {
			try {
				fs.rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// Best-effort cleanup for Windows file locks
			}
		}
	});

	it('proves unsupported versions (1.3.3) are rejected before any agent turn can start', async () => {
		if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
		process.env.FAKE_AGY_VERSION = '1.3.3';
		delete process.env.FAKE_AGY_MODE;

		vi.spyOn(config, 'cliPath').mockReturnValue(fakeAgyPath);

		await expect(runAgySearch('why is the sky blue', dummyToken)).rejects.toThrow(
			`requires agy ${AGY_SEARCH_MIN_VERSION} or newer for isolated tool enforcement.`,
		);

		expect(fs.existsSync(logPath)).toBe(true);
		const recordedCalls = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
		expect(recordedCalls).toEqual(['CALL: --version']);
		expect(recordedCalls.some(call => call.includes('--print') || call.includes('--agent'))).toBe(false);
	});

	it('executes the isolated custom agent end-to-end when version is supported (1.4.5)', async () => {
		if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
		process.env.FAKE_AGY_VERSION = '1.4.5';
		delete process.env.FAKE_AGY_MODE;

		vi.spyOn(config, 'cliPath').mockReturnValue(fakeAgyPath);

		const result = await runAgySearch('latest Gemini updates', dummyToken);
		expect(result).toBe('Grounded search answer');

		expect(fs.existsSync(logPath)).toBe(true);
		const recordedCalls = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
		expect(recordedCalls).toHaveLength(2);
		expect(recordedCalls[0]).toBe('CALL: --version');

		const secondCall = recordedCalls[1];
		expect(secondCall).toContain('--agent');
		expect(secondCall).toContain(AGY_SEARCH_AGENT_PREFIX);
		expect(secondCall).toContain('--print');
		expect(secondCall).toContain('--disable-slash-commands');
		expect(secondCall).toContain('--print-timeout 90s');
	});

	it('fails closed and rejects if a binary reports supported version but emits default agent output', async () => {
		if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
		process.env.FAKE_AGY_VERSION = '1.4.5';
		process.env.FAKE_AGY_MODE = 'spoof_default';

		vi.spyOn(config, 'cliPath').mockReturnValue(fakeAgyPath);

		await expect(runAgySearch('test query', dummyToken)).rejects.toThrow(
			'Antigravity CLI did not start the isolated Web Search agent.',
		);

		expect(fs.existsSync(logPath)).toBe(true);
		const recordedCalls = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
		expect(recordedCalls).toHaveLength(2);
		expect(recordedCalls[0]).toBe('CALL: --version');
		expect(recordedCalls[1]).toContain('--agent');
	});
});
