# BRIEFING — 2026-10-07T14:19:00Z

## Mission
Investigate Indeed scraper timeout issue and Bright Data MCP vs Playwright fallback mechanics (R2).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, synthesizer
- Working directory: C:\laragon\www\job scrapper\.agents\teamwork\explorer_survey_r2
- Original parent: 0d167de4-b714-439b-a11a-b3de82e38e31
- Milestone: R2 - Indeed Scraper Timeout & Fallback Investigation

## 🔒 Key Constraints
- Read-only investigation — do NOT implement / modify source code or config files.
- Produce 5-component handoff report in .agents/teamwork/explorer_survey_r2/handoff.md.
- Maintain progress.md with liveness heartbeat.

## Current Parent
- Conversation ID: 0d167de4-b714-439b-a11a-b3de82e38e31
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `src/scrapers/index.js` (lines 100-250: `runSiteScraper`, `withTimeout`, default timeout `45000`)
  - `config/sites.json` (line 36: `"timeoutMs": 60000` for `indeed`)
  - `profiles/tolu/preferences.json` (lines 80-85 & 294-300: duplicate `"indeed"` blocks, missing `timeoutMs`)
  - `src/scrapers/indeed.js` (lines 1-601: `fetchJobs`, `fetchIndeedViaBrightData`, `fetchWithBackoff`, `resolveIndeedSearchUrls`)
  - `scripts/check-scrapers.mjs` and `npm run scrapers:check` (38/38 passing)
  - `test/indeedScraper.test.js` and `test/indeedIntegration.test.js` (9/9 passing)
- **Key findings**:
  - The 60,000 ms timeout originates from `config/sites.json:36` (`"timeoutMs": 60000`), which overrides the default in `src/scrapers/index.js` (`45000`) because `profiles/tolu/preferences.json` lacks a `timeoutMs` override.
  - `src/scrapers/indeed.js` queries up to 33 URLs for Tolu. In `fetchJobs`, Bright Data MCP uses `fetchWithBackoff` (up to 3 retries) and 60,000 ms per-request timeout. On failure, it continues looping across all 33 URLs without circuit breaking or deadline checking, exceeding 60,000 ms so `withTimeout` rejects before Playwright fallback is even attempted.
  - If Playwright is reached, it also loops over 33 URLs with 35s navigation timeouts and no deadline checks.
  - Increasing timeouts to 120,000 ms in `config/sites.json`, `profiles/tolu/preferences.json`, and defaulting to 120,000 ms for indeed (90,000 ms general) in `src/scrapers/index.js`, combined with a strict time budget and early circuit breaker in `src/scrapers/indeed.js`, completely resolves the issue.
- **Unexplored areas**: No unexplored areas in the Indeed scraper or timeout mechanics.

## Key Decisions Made
- Confirmed root cause of "indeed scraper timed out after 60000ms".
- Designed graceful fallback and time budgeting mechanics for worker implementation.

## Artifact Index
- C:\laragon\www\job scrapper\.agents\teamwork\explorer_survey_r2\DISPATCH.md — Received dispatch message
- C:\laragon\www\job scrapper\.agents\teamwork\explorer_survey_r2\progress.md — Liveness heartbeat and step tracker
- C:\laragon\www\job scrapper\.agents\teamwork\explorer_survey_r2\handoff.md — 5-component handoff report
