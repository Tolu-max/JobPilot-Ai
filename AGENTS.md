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

## Multi-AI Collaboration & AWS Guide

See [docs/AI_COLLABORATION_AND_AWS_GUIDE.md](docs/AI_COLLABORATION_AND_AWS_GUIDE.md) for:
- Detailed instructions for any AI model (Claude Code, ChatGPT/Codex, Gemini, Cursor) working on this codebase.
- AWS EC2 operations (`13.60.173.41` / PM2).
- The 6 anti-vibe-coding engineering gates (contract-first inspection, 274+ automated tests, photographic submission proof, and zero-tolerance role leakage checks).

## Recent Milestones

- **HotNigerianJobs (`hotnigerianjobs`)**: Full scraper and gateway adapter implemented, audited, and deployed. 36 registered scrapers, live proof captured.
- **Ngcareers (`ngcareers`)**: Integrated Nigerian portal covering Lagos, Abuja, remote tech (`it-software?work_type=remote`), and administrative support (`admin-office`). Scraper & adapter implemented with ATS gateway resolution and candidate isolation (Tolu dev vs Sister support). 37 registered scrapers passing `scrapers:check` and 360+ tests passing.
- **Indeed (`indeed`)**: Full scraper and gateway adapter implemented, audited, and tested. Uses Playwright stealth with `mosaic-data` structured JSON extraction from `indeed.com` (Remote) and `ng.indeed.com` (Nigeria). Features automated ATS gateway resolution (Greenhouse, Lever, Workable, Ashby, BambooHR, SmartRecruiters) for direct auto-apply and safe Easy Apply review routing. 38 registered scrapers passing `scrapers:check` and 385 automated tests passing with 0 failures.
- **LinkedIn (`linkedin`)**: Full scraper and gateway adapter implemented, audited, and tested. Supports Bright Data MCP markdown scraping and Playwright stealth across global remote tech/support roles and Nigerian markets (Abuja onsite/hybrid & tech). Features candidate isolation (Tolu dev vs Sister support), continuous query rotation, automated ATS gateway resolution (Greenhouse, Lever, Workable, Ashby, BambooHR, SmartRecruiters), and safe Easy Apply review routing. 16 new automated tests passing with 0 failures.
- **LinkedIn Authenticated Session & Cookies (Tolu)**: Successfully ingested and verified Tolu's active LinkedIn session cookies in `profiles/tolu/linkedin_cookies.json`. Live Playwright session confirmed authenticated with full access to LinkedIn feed and job listings.
- **Candidate Site Routing**: Sister temporarily restricted to `["bruntwork"]` on Railway and preferences until candidate tokens/cookies are provided. Tolu enabled on `["bruntwork", "indeed", "linkedin"]`.
- **ATS Adapter Hardening**: Fixed 'same-indeed-page' redirect loop in Indeed adapter; implemented robust Easy Apply detection in LinkedIn adapter; enhanced generic adapter with 10-second polling for definitive submission proof; added `externalApplyUrl` passthrough in ATS resolver.
- **Roadmap Idea — Email Application Automation**: For Indeed, LinkedIn, and Nigerian portals that instruct candidates to "submit CV via email", capture destination recruiter emails via regex/mailto extraction and route to automated Gmail/SMTP dispatch with candidate tailored resume and cover letter.


## Pipeline Redesign
- Monolithic orchestration in src/pipeline.js separated into 7 distinct phases: SCRAPE, FILTER, SCORE, TRIAGE, REVIEW_FLUSH, APPLY, PERSIST.
- Added Phase 3 checkpointing (<profileDir>/pipeline_checkpoint.json) for resume logic after crashes.
- flushPendingApplyQueue modified to check for deterministic failures and push them to manual_review status rather than looping infinitely on pending_apply.
- applicationRetryPolicy configured with maxRetries defaults to 3.
- Centralized PHASE_TIMEOUTS added to config.js.
- Dead code in automation.js identified and marked for extraction to adapters.
