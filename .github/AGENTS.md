# GitHub automation

## Ownership and contracts

- This directory holds one workflow. `workflows/publish.yml` publishes a
  maintainer-built VSIX with Marketplace Trusted Publishing (OIDC). It is opt-in:
  it runs when a GitHub release carrying the packaged `.vsix` asset is published,
  or by manual dispatch naming that tag. CI never receives OAuth credentials and
  stores no PAT; the job keeps `contents: read` and requests only `id-token:
  write` for the OIDC exchange. It publishes exactly the release asset, so the
  VSIX is built locally where `src/api/credentials.ts` already lives.
- The Marketplace publisher must hold a Trusted Publishing policy for
  `lutfi238/antigravity-for-copilot-vscode` and workflow `publish.yml`. Without
  that policy the OIDC exchange fails before anything is uploaded.
- Automated PR review (PR-Agent) was removed because the pinned Gemini model
  returned `503 Service Unavailable` and failed the review check on unrelated
  contributor PRs. Do not reintroduce a provider-backed review bot without a
  maintainer decision and a documented failure-mode policy.
- If a workflow is ever added here, keep it opt-in, never reuse local OAuth
  credentials, never commit API keys, pin any executing Docker image by digest,
  never check out or execute contributor code in a privileged workflow, and keep
  contents read-only with no approval, merge, or code-push permissions.
- Keep maintenance files here excluded from VSIX packaging.

## Verification

- `actionlint .github/workflows/*.yml` validates YAML and expressions for any
  workflow that exists.
- Exercise provider validation with synthetic keys only; never print real keys.
- Do not claim a live end-to-end check succeeded based only on lint or a skipped
  workflow.
