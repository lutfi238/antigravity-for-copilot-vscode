import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			// The real `vscode` module only exists inside an extension host.
			vscode: path.resolve(__dirname, 'test/vscode-stub.ts'),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
