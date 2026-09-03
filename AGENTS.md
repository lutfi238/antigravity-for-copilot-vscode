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
- Do not commit generated `dist/` output or packaged `.vsix` artifacts unless a release workflow explicitly requires them.

## Work Guidance

- Read this file, then follow the Child DOX Index to every path being changed.
- Keep `package.json`, README configuration/commands, and implementation behavior aligned when changing public features.
- Add release-facing changes to `CHANGELOG.md`; do not use it as an implementation diary.
- Preserve user-owned worktree changes and never commit unless explicitly requested.

## Verification

- Full check: `npm run check` (typecheck, Vitest, then esbuild bundle).
- Type-only check: `npm run typecheck`.
- Tests: `npm test`.
- VSIX packaging: `npm run package:vsix`.
- Runtime behavior still requires an Extension Development Host (`F5`) and a usable Antigravity account; build success alone does not verify OAuth or gateway behavior.

## Child DOX Index

- [`src/AGENTS.md`](src/AGENTS.md) — extension lifecycle, provider orchestration, configuration, logging, and source-domain index.
- [`test/AGENTS.md`](test/AGENTS.md) — Vitest contracts, coverage map, and VS Code test stub.
- Root-owned files: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.js`, `icon.build.cjs`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `media/`.
