# GitHub automation

## Ownership and contracts

- This directory holds no workflows. Automated PR review (PR-Agent) was removed
  because the pinned Gemini model returned `503 Service Unavailable` and failed
  the review check on unrelated contributor PRs. Do not reintroduce a
  provider-backed review bot without a maintainer decision and a documented
  failure-mode policy.
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
