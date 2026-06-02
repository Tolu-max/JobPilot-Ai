# JobPilot Project Memory

Use this file as durable context for future Codex/agent sessions.

## Product Identity

- Product name: **JobPilot**.
- Avoid reverting to **JobPilot AI** in product copy unless the user explicitly asks.
- Positioning: open-source, local-first job automation with optional hosted dashboard sync.

## Security Boundary

JobPilot must stay local-first by default.

The hosted web/dashboard may handle:

- Account auth.
- Review approvals/rejections.
- Job metadata: title, company, source, URL, score, status, timestamps.
- Safe profile labels and thresholds.
- Analytics and setup guidance.

The hosted web/dashboard must not collect or store by default:

- AI provider API keys.
- CAPTCHA solver keys.
- CVs/resumes, audio/video recordings, screenshots, or private application files.
- Browser profiles, cookies, sessions, or local storage.
- Job-board passwords.
- Telegram bot tokens.

## Automation Policy

- Default automation should be dry-run or review-first.
- Live submit is allowed only when all gates pass:
  - The profile is a fit for the role.
  - Location/country rules pass.
  - The role is recent enough.
  - Duplicate/cross-profile checks pass.
  - User/profile approval exists.
  - The ATS or application flow is audited.
  - CAPTCHA handling is configured locally when needed.
- Unknown ATS systems should route to manual review.
- Source boards that redirect to company pages should resolve gateways first, then hand off only to audited apply handlers.
- CAPTCHA solving is optional, user-owned, and paid by the user. Prefer generic wording: "CAPTCHA solver" or "CapSolver"; do not call it a BruntWork solver.

## Current Architecture

- CLI/local runner owns sensitive automation.
- Hosted dashboard is an optional metadata/review layer.
- Telegram setup is local: users create their own bot and run `jobpilot telegram --profile=<profile>`.
- The dashboard should not launch browser automation directly.
- Profile settings on the web should be limited to safe metadata such as display name, role summary, score threshold, and auto-apply preference.

## Useful Commands

```bash
npm test
npm run scrapers:check
npm run release:check

cd website
npm run lint
npm run build
```

For a comfortable automation pass:

```bash
jobpilot doctor --profile=<profile>
jobpilot run --profile=<profile> --limit 50 --review-first
jobpilot scheduler --profile=<profile>
```

## Git / Open Source Hygiene

Never commit:

- `.env` or `.env.*` except `.env.example`.
- `profiles/` private profile data.
- PDFs, DOCX files, audio files, recordings, browser profiles, logs, debug output, audit output, or screenshots.
- Local agent/editor folders such as `.claude/` and `.vscode/`.

Before release, run the privacy/release checks and verify `git status --ignored` does not expose private candidate files.
