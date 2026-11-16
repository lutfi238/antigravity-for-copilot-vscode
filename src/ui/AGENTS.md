# Extension UI

## Purpose

- Present account, quota, logs, settings, and refresh actions through native VS Code UI.

## Ownership

- `manage.ts` owns the management QuickPick and sign-in/auth-status flows.
- `statusBar.ts` owns signed-out, loading, hidden, and quota-summary status bar states.

## Local Contracts

- Use native VS Code commands, QuickPick/message APIs, settings navigation, and status bar items.
- Keep account switching and removal synchronized with `AccountStore` notifications and provider refresh.
- Display standard Gemini (Pro and Flash), discovered Gemini Argon, and Claude/GPT quota groups. Omit Argon from the tooltip and accessibility label when the catalogue does not report it; clear it on account switches and preserve exhausted zero versus unknown quota.
- Standard Gemini may additionally receive explicit five-hour/weekly summary windows. Display each percentage with its own reset, preserve unknown windows, and retain the unclassified discovery display when the summary is unavailable. Ignore late updates for a different account, refresh, disposal or sign-out; do not relabel Argon or Claude/GPT windows.
- Display account AI credit balance separately from baseline quota, preserving explicit zero and distinguishing missing metadata. Credit display never changes spending settings.
- Keep the bar compact; separate account/plan and each quota/reset group in the tooltip. Show only backend-reported plans, distinguish loading from missing metadata, count models actually offered in the picker, and ignore late plan updates for another account.
- Label the tooltip's catalogue timestamp as the model list, not as quota. That value is the model-discovery time; Gemini limits carry their own `Limits updated` line from `geminiQuota.updatedAt`. Never present one source's freshness as another's.
- Nothing polls. Freshness comes from activation, account changes, model-affecting setting changes, the explicit refresh command, and the provider's window-focus handler. That handler must stay a no-op while signed out and while the snapshot is younger than the catalogue TTL, because a refresh invalidates the discovery, quota, and plan caches and would otherwise refetch on every alt-tab.
- The tooltip carries `command:` links to `antigravity.refresh` and `antigravity.manage`. Keep `isTrusted = true` on the `MarkdownString`, or VS Code renders the markdown but silently ignores the links. The explicit refresh command must keep bypassing the TTL: it clears the catalogue and invalidates the quota/plan caches rather than relying on expiry.
- Respect `antigravity.showStatusBar` and dispose all UI resources through the extension context.
- User-facing errors should be actionable and must not reveal credentials, tokens, prompts, or tool data.

## Work Guidance

- Keep UI orchestration thin; authentication and catalogue rules remain in their owning modules.
- Update `package.json` command/configuration contributions and README text when public UI changes.

## Verification

- `npm run typecheck`
- `npm test -- test/statusBar.test.ts` verifies quota text with a mocked VS Code status bar; exercise real rendering, QuickPick and command flows in an Extension Development Host.

## Child DOX Index

- No child AGENTS.md files are needed; this folder is one native VS Code UI boundary.
