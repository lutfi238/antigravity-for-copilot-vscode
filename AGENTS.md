# Antigravity Model Bridge

## Purpose

- Provide a VS Code Language Model Chat Provider with vendor id `antigravity`.
- Bridge native Copilot Chat requests to Google Antigravity's undocumented `v1internal` gateway for Gemini, Claude, and GPT-OSS models.
- Keep authentication, model discovery, tool calling, reasoning, streaming, quota display, and account management inside the local VS Code UI extension host.

## Repository Contracts

- Treat the gateway as unstable and undocumented; preserve wire behavior backed by source, tests, or observed client behavior.
- Keep the extension unofficial disclaimer and account-risk warning in user-facing documentation.
- Require VS Code `^1.108.0`; the extension runs as `extensionKind: ["ui"]` so loopback OAuth remains local.
- Keep OAuth credentials out of version control. Local builds require ignored `src/api/credentials.ts`, copied from `src/api/credentials.example.ts` and filled with real values.
- Never delete `src/api/credentials.ts` while cleaning up a task, and never run `git clean -x` in this repository. The file is git-ignored and was never committed, so nothing can restore it from history and every later build fails at the `esbuild.js` guard.
- When the file is missing, recover the client id/secret from an already-installed build (`~/.vscode/extensions/lutfi.antigravity-for-copilot-*/dist/extension.js`) or the local Antigravity CLI, write them into the ignored file without printing them, and report only that it was restored. Never fabricate placeholders and never bypass or weaken the `esbuild.js` credential check.
- Do not commit generated `dist/` output or packaged `.vsix` artifacts unless a release workflow explicitly requires them.

## Work Guidance

- Read this file, then follow the Child DOX Index to every path being changed.
- Keep `package.json`, README configuration/commands, and implementation behavior aligned when changing public features.
- Add release-facing changes to `CHANGELOG.md`; do not use it as an implementation diary.
- Never use an `## Unreleased` heading. Write entries under the next real version number at the top of `CHANGELOG.md` (for example `## 0.15.24` immediately after a published `0.15.23`), so the file always reads as shipped versions. Bump `package.json` to that same version when packaging or publishing. Do not invent intermediate version numbers for local test builds: package them at the version being released, and delete the previous `.vsix` instead.
- Preserve user-owned worktree changes and never commit unless explicitly requested.

## Verification

- Full check: `npm run check` (typecheck, Vitest, then esbuild bundle).
- Type-only check: `npm run typecheck`.
- Tests: `npm test`.
- VSIX packaging: `npm run package:vsix`.
- Publishing: attach the packaged VSIX to a GitHub release; `.github/workflows/publish.yml` publishes that exact asset with Trusted Publishing (OIDC). No PAT and no OAuth credentials are stored in CI.
- Before packaging, confirm `src/api/credentials.ts` exists and contains no `REPLACE_ME`; the build exits early otherwise. Leave that file in place after the build.
- Runtime behavior still requires an Extension Development Host (`F5`) and a usable Antigravity account; build success alone does not verify OAuth or gateway behavior.

## Child DOX Index

- [`.github/AGENTS.md`](.github/AGENTS.md) — opt-in PR review automation, permissions, secrets, and workflow verification.
- [`src/AGENTS.md`](src/AGENTS.md) — extension lifecycle, provider orchestration, configuration, logging, and source-domain index.
- [`test/AGENTS.md`](test/AGENTS.md) — Vitest contracts, coverage map, and VS Code test stub.
- Root-owned files: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.js`, `icon.build.cjs`, `README.md`, `CHANGELOG.md`, `LICENSE`, `ANTIGRAVITY_CAPABILITIES.md`, and `media/`.
