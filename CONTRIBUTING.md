# Contributing to JobPilot

Thanks for thinking about contributing! JobPilot is a Node.js (ESM) project built around a local-first CLI: Playwright + your choice of AI provider for matching, with Telegram notifications, a terminal dashboard, and optional hosted dashboard sync layered on top.

## Quick dev setup

```bash
git clone https://github.com/<you>/jobpilot.git
cd jobpilot
npm install
cp .env.example .env           # edit at minimum: GEMINI_API_KEY, APPLICANT_EMAIL
node cli.js init               # interactive profile wizard
node cli.js doctor             # sanity-check the install
```

Then run a single pass against your new profile:

```bash
node index.js --profile=<your-profile-name>
```

Or start the long-running scheduler (loops every `SCHEDULER_INTERVAL_MS`):

```bash
npm run scheduler
```

Set `HEADLESS=false` in `.env` while developing — the browser window tells you a *lot* about what's going wrong before you reach for logs.

## Repository layout

```
cli.js                 Entry point for `jobpilot` CLI
index.js               Single-shot pipeline runner
src/
  pipeline.js          Orchestrator: scrape → score → apply
  config.js            All env-var loading and per-profile resolution
  scheduler.js         Long-running loop
  scrapers/            One file per job site (RemoteOK, Remotive, ...)
  adapters/            One file per apply-form flow (bruntwork.js, ...)
  ai*/                 AI router + provider clients (Gemini, OpenRouter, Groq)
  cli/                 Wizard, doctor, interactive menus, TUI
  notifications*/      Telegram bot + email
  dashboard*/          Dev-only local web dashboard pieces
profiles/<name>/       One folder per applicant — preferences, candidate, CV
```

## Product boundaries

- Keep scraping, AI provider calls, CAPTCHA solving, browser automation, resumes, cookies, and job-board credentials local by default.
- Hosted web work should focus on account auth, review queues, analytics, and syncing safe job metadata.
- Do not add flows that upload provider API keys, CAPTCHA keys, resumes, or browser profiles to the hosted dashboard in the standard open-source path.
- If a feature needs hosted automation, design it as an explicit managed-worker mode with encrypted secrets, quotas, and audit logs.

## Adding a new job site

Two pieces are needed: a **scraper** (lists jobs) and, if the site requires more than a generic form fill, an **adapter** (drives the apply flow).

1. **Scraper.** Drop a file in `src/scrapers/<site>.js` that exports `async function scrape(config)` returning `[{ id, title, company, url, description, location, source }, ...]`. Look at `src/scrapers/remoteok.js` for the simplest reference.
2. **Adapter** (optional). If the site has multi-step forms or captchas, add `src/adapters/<site>.js`. Use `src/adapters/bruntwork.js` as a template — it documents the EMAIL → DETAILS → SUBMIT flow at the top of the file. Adapters expose `matches(url)`, `getCurrentStep(page)`, and `advance(page, ctx)`.
3. Register the site name in `ENABLED_SITES` (default `.env.example`) and in the wizard's site list (`src/cli/onboarding.js`).
4. Add a smoke test under `test/` or extend `scripts/scrapers-health.mjs`.

## Testing

```bash
npm test                  # unit + adapter test mode
npm run scrapers:check    # static scraper validation
npm run scrapers:health   # live HTTP probes (rate-limited, opt-in)
```

The live scraper and browser tests are opt-in via `RUN_BROWSER_TESTS=1` / `RUN_LIVE_SCRAPER_TESTS=1` to keep CI cheap.

## Pull request conventions

- One concern per PR. A new adapter and a wizard refactor are two PRs.
- Run `npm test` before pushing.
- If you change an adapter, include a short note about how you verified it (URL of a job posting you applied to, or screenshot of the form). Adapters drift faster than any other part of the codebase.
- Don't commit anything under `profiles/<your-name>/`, your `.env`, or any browser-profile directory. They're gitignored by default but double-check `git status`.

## Reporting bugs

Two things make a bug report ten times easier to fix:

1. **Profile dump** (with personal info redacted) — `profiles/<name>/preferences.json` and the relevant chunk of `processedJobs.json`.
2. **Browser-visible reproduction** — set `HEADLESS=false`, re-run the failing site, screenshot the moment things break.

## Code of conduct

Be kind, assume good faith, no harassment. That's it.
