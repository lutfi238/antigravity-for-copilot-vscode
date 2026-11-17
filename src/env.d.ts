/**
 * Compile-time flags substituted by `esbuild.js` via `define`.
 *
 * These are replaced with a literal at build time, so a `false` value makes the guarded
 * branch dead code and lets the bundler drop the module it references.
 */

/** True for a development bundle, false under `--production` (`vscode:prepublish`). */
declare const __DEV_PROBE__: boolean;
