const esbuild = require('esbuild');

const fs = require('fs');

// Fail loudly rather than shipping a build that cannot authenticate. The credentials
// module is git-ignored, so a fresh clone must create it before building.
const CREDS = 'src/api/credentials.ts';
if (!fs.existsSync(CREDS)) {
	console.error(
		`\n  Missing ${CREDS}\n\n` +
			'  Copy the template and fill in the Antigravity OAuth client values:\n' +
			'      cp src/api/credentials.example.ts src/api/credentials.ts\n\n' +
			'  See src/api/credentials.example.ts for where those values come from.\n',
	);
	process.exit(1);
}
if (/REPLACE_ME/.test(fs.readFileSync(CREDS, 'utf8'))) {
	console.error(`\n  ${CREDS} still contains REPLACE_ME placeholders.\n`);
	process.exit(1);
}

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Reports build errors with file/line so they are clickable in the terminal. */
const problemMatcherPlugin = {
	name: 'problem-matcher',
	setup(build) {
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}`);
				}
			}
			console.log(`[${watch ? 'watch' : 'build'}] finished`);
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: 'silent',
		plugins: [problemMatcherPlugin],
	});

	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
