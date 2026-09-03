# Extension UI

## Purpose

- Present account, quota, logs, settings, and refresh actions through native VS Code UI.

## Ownership

- `manage.ts` owns the management QuickPick and sign-in/auth-status flows.
- `statusBar.ts` owns signed-out, loading, hidden, and quota-summary status bar states.

## Local Contracts

- Use native VS Code commands, QuickPick/message APIs, settings navigation, and status bar items.
- Keep account switching and removal synchronized with `AccountStore` notifications and provider refresh.
- Display quota as three backend buckets: Gemini Pro, Gemini Flash, and Claude/GPT.
- Respect `antigravity.showStatusBar` and dispose all UI resources through the extension context.
- User-facing errors should be actionable and must not reveal credentials, tokens, prompts, or tool data.

## Work Guidance

- Keep UI orchestration thin; authentication and catalogue rules remain in their owning modules.
- Update `package.json` command/configuration contributions and README text when public UI changes.

## Verification

- `npm run typecheck`
- Exercise changed QuickPick, command, and status bar flows in an Extension Development Host; no direct UI unit tests currently exist.

## Child DOX Index

- No child AGENTS.md files are needed; this folder is one native VS Code UI boundary.
