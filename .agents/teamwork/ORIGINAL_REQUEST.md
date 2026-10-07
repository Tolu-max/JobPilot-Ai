# Original User Request

## 2026-10-07T14:07:28Z

JobPilot is a live, open-source, local-first job automation system at `C:\laragon\www\job scrapper`. It is deployed on Railway and actively running every 30 minutes. Telegram review notifications are working. The system needs three targeted fixes shipped today: (1) unblock Tolu's auto-apply which is stuck at 0 despite high-scoring jobs, (2) stop Indeed from timing out, and (3) reduce per-run errors from 12–33 down to near zero.

Working directory: C:\laragon\www\job scrapper
Integrity mode: development

## Context

- Node.js ESM project (`"type": "module"`, `.js` files)
- Deployed on Railway via `railway up --detach` from the working directory
- 401+ automated tests in `test/` run with `npm test` (must stay green)
- 38 scrapers checked with `npm run scrapers:check`
- Active profiles: `profiles/tolu/` and `profiles/sister/`
- Key files: `src/pipeline.js`, `src/automation.js`, `src/scrapers/indeed.js`, `src/scrapers/index.js`, `src/adapters/`, `src/telegramBot.js`, `src/config.js`
- Railway env var: `TELEGRAM_REVIEW_MIN_SCORE=65`, `TOLU_AUTO_APPLY=true`

## Known State (from live Telegram logs, Oct 6 2026)

- Tolu: 45–55 scraped per run, 16 review notifications sent, **0 auto-applied** despite scores of 84, 86, 88, 90/100 which are all above the 75 threshold
- Indeed: timing out at 60 000 ms on some runs (`indeed scraper timed out after 60000ms`)
- Sister: working correctly — 1 bruntwork application submitted
- Errors: 12–33 per run across both profiles
- `profiles/tolu/preferences.json`: `autoApply: true`, `autoApplyScoreThreshold: 75`, `enabledSites: ["bruntwork", "indeed", "linkedin"]`

## Requirements

### R1. Fix Tolu's auto-apply gate

Jobs scoring ≥ 75 on **audited ATS platforms** (Greenhouse, Lever, Workable, Ashby, BambooHR, SmartRecruiters, and BruntWork) must auto-apply without waiting for Telegram approval. Read `src/automation.js`, `src/pipeline.js`, `src/adapters/atsResolver.js`, and `src/adapters/index.js` to find why high-scoring jobs (77–90/100) are being sent to `needs_manual_review` or `pending_review` instead of `auto_apply`. Fix the gate so that when all conditions are met — score ≥ threshold, ATS is in the audited list, location/country rules pass, no duplicate — the job is applied to automatically. Do not remove the review path for jobs that genuinely need it (unknown ATS, score below threshold, US work auth required, etc.).

### R2. Fix Indeed scraper timeout

The Indeed scraper at `src/scrapers/indeed.js` times out at 60 000 ms on Railway. The scraper has two paths: Bright Data MCP (primary) and Playwright (fallback). Increase the per-scraper timeout for `indeed` to 120 000 ms in `src/scrapers/index.js` (line ~211) and in `profiles/tolu/preferences.json` under `sites.indeed.timeoutMs`. Also ensure the Bright Data MCP path is tried first and that a failure there falls through gracefully to Playwright without the whole scraper aborting. The scraper must complete all its search URLs within the new timeout or skip remaining URLs cleanly rather than hanging.

### R3. Reduce per-run errors

Each run produces 12–33 logged errors. Read `src/pipeline.js` and `src/automation.js` to identify the most frequent error categories. The top priorities are: (a) jobs stuck in `pending_apply` that keep retrying after deterministic failures (e.g. "same-indeed-page", "no external ATS URL") — these should be permanently moved to `manual_review` after 3 failed attempts; (b) scraper network errors that surface as top-level pipeline errors instead of being caught per-site; (c) any uncaught promise rejections that count as errors. Fix the top 3 error categories. Do not introduce new errors.

## Acceptance Criteria

### Auto-apply gate (R1)
- [ ] At least one of Tolu's high-scoring indeed or linkedin jobs (≥ 75/100 on an audited ATS) results in an automated application attempt (status `applied` or `pending_apply`) on the next Railway run — verified by checking `profiles/tolu/processedJobs.json` on Railway volume or via Telegram `🟢 APPLIED` notification
- [ ] Jobs with unknown ATS, US work auth requirement, or score below threshold still go to Telegram review — not auto-applied
- [ ] `npm test` passes with 401+ tests, 0 failures after changes

### Indeed timeout (R2)
- [ ] `profiles/tolu/preferences.json` has `sites.indeed.timeoutMs` set to 120000 or higher
- [ ] `src/scrapers/index.js` default timeout at line ~211 is increased to at least 90000
- [ ] A run with Indeed enabled completes without the `"indeed scraper timed out after 60000ms"` error (verified from Railway logs or local test run)
- [ ] `npm run scrapers:check` still passes (38/38)

### Error reduction (R3)
- [ ] Jobs that fail with deterministic errors 3+ times are marked `manual_review` in `processedJobs.json` and not retried
- [ ] Per-run error count drops below 10 on a run with both profiles active (measured from the Telegram run summary message)
- [ ] `npm test` still passes after changes

### Deploy
- [ ] Changes deployed to Railway with `railway up --detach`
- [ ] First post-deploy run summary sent to Telegram with no critical errors and at least one `🟢 APPLIED` for Tolu
