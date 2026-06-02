# JobPilot

> Open-source AI job-hunt agent. Scrapes job boards, scores postings against your CV, and (optionally) auto-applies across as many profiles as you want, with Telegram notifications, a terminal dashboard, and optional hosted dashboard sync.

JobPilot runs **locally first**. There's no required account, no hosted dependency, no telemetry. AI providers, CAPTCHA solvers, resumes, cookies, and Telegram credentials stay on your machine by default.

The hosted product is a dashboard/account layer, not the default automation runner. The CLI does the sensitive work locally; hosted sync only needs safe job metadata such as title, score, status, source, and timestamps.

---

## Automation Runbook

For the recommended open-source operating model, see [docs/AUTOMATION_RUNBOOK.md](docs/AUTOMATION_RUNBOOK.md). In short: scrape and score automatically, review before live submit, and keep resumes, provider keys, CAPTCHA keys, Telegram tokens, and browser sessions local.

Before publishing or contributing, also read [docs/SAFETY.md](docs/SAFETY.md), [SECURITY.md](SECURITY.md), [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), [docs/PXXL_DEPLOYMENT.md](docs/PXXL_DEPLOYMENT.md), [docs/RAILWAY_RUNNER.md](docs/RAILWAY_RUNNER.md), and [ROADMAP.md](ROADMAP.md).

---

## Features

- **AI-ranked matches.** Local lexical scoring first, then optional Gemini / OpenRouter / Groq for deeper analysis. AI only fires on jobs above a score threshold you set.
- **Multi-profile.** One install can run a job hunt for you, your partner, your sibling — each with its own CV, preferences, history, and per-site limits.
- **Pluggable adapters.** Per-site apply-form drivers for audited flows such as BruntWork and Greenhouse. Generic form-fill fallback for everything else.
- **Gateway-aware.** Source boards such as RemoteOK and RemoteJobs.org can resolve company apply pages and hand off only to audited adapters.
- **CAPTCHA-aware.** Optional paid CapSolver integration for CAPTCHA-protected forms; uncertain forms drop into a manual-review queue instead of failing silently.
- **Cross-profile dedupe.** Won't double-apply to the same posting from two profiles unless you explicitly allow it.
- **Telegram + dashboards.** Daily summaries, per-job notifications, a local terminal dashboard, and optional hosted dashboard sync.
- **Safe defaults.** Test mode on, auto-apply off, headless browser on. Private profiles can opt into live automation after dry-run testing.

---

## Requirements

- Node.js 20 +
- npm
- Chromium (installed automatically by Playwright on `npm install`)
- Optional: PM2 if you want the scheduler as a background service

---

## Quickstart

```bash
git clone https://github.com/<you>/jobpilot.git
cd jobpilot
npm install

# 1. Create your .env from the template
cp .env.example .env            # Windows: copy .env.example .env

# 2. Walk the interactive wizard - parses your CV, builds a profile
jobpilot init                   # or:  node cli.js init

# 3. Sanity-check the install
jobpilot doctor

# 4. Single pass against your new profile
jobpilot run --profile=<your-profile>

# 5. (Optional) start the long-running scheduler
jobpilot scheduler              # foreground, ideal for Docker / Railway / Render
# or
npm run bot:start               # background via PM2 (local dev)
```

The wizard writes everything it needs into `profiles/<name>/` and appends provider keys to `.env`. You shouldn't need to edit any JSON by hand for a first run.

---

## CLI

```bash
jobpilot                 # interactive launcher (default)
jobpilot init            # create / edit a profile
jobpilot run             # single foreground pass
jobpilot scheduler       # long-running local/self-hosted scheduler
jobpilot dashboard       # local terminal dashboard
jobpilot status          # one-shot snapshot
jobpilot review          # walk the manual-review queue
jobpilot telegram        # link a local Telegram bot/chat
jobpilot doctor          # diagnose config & install
jobpilot profiles        # list configured profiles
jobpilot chat            # AI assistant
```

Pass `--profile=<name>` to scope any command to one profile.

---

## Configuration

All knobs live in `.env` (see [`.env.example`](.env.example) for the annotated list). Common ones:

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `gemini` | `gemini` \| `openrouter` \| `groq` |
| `GEMINI_API_KEY` | — | Free tier at aistudio.google.com |
| `CAPSOLVER_API_KEY` | — | Optional paid solver for CAPTCHA-protected forms |
| `AUTO_APPLY` | `false` | Master switch. The wizard sets per-profile overrides. |
| `TEST_MODE` | `true` | When true, forms fill but never submit. |
| `ALLOW_GATEWAY_AUTO_SUBMIT` | `false` | Lets source boards hand off to audited apply adapters after testing. |
| `SCHEDULER_INTERVAL_MS` | `14400000` | 4 h. Drop to `60000` for testing. |
| `ENABLED_SITES` | `bruntwork,remoteok,remotive` | Comma-separated. |
| `HEADLESS` | `true` | Set `false` to watch the browser while debugging. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | — | Both required if you want Telegram notifications. |

### Per-profile overrides

Any setting can be overridden per profile by prefixing with the uppercased profile name:

```env
SISTER_APPLICANT_EMAIL=sister@example.com
SISTER_AUTO_APPLY=true
SISTER_MAX_JOBS_PER_RUN=50
```

---

## Profiles

Each profile is a folder under `profiles/`:

```
profiles/<name>/
  preferences.json         # what jobs to chase, site limits, thresholds
  candidateProfile.json    # skills, target roles, hard filters
  cv-data.json             # AI-parsed resume cache
  resume.pdf               # your CV (PDF / DOCX / TXT)
  processedJobs.json       # local history (auto-managed)
  reviewQueue.json         # jobs needing your eyes (auto-managed)
```

Real profile folders are gitignored by default. The wizard is the supported way to create new ones; you can copy `profiles/example/` as a starting point if you'd rather edit by hand.

---

## Architecture

```
                 ┌─────────────┐
                 │   cli.js    │  ── init, doctor, start, tui, ...
                 └──────┬──────┘
                        │
       ┌────────────────┼────────────────────┐
       │                │                    │
┌──────▼──────┐  ┌──────▼──────┐      ┌──────▼──────┐
│ scheduler   │  │  pipeline   │      │  dashboard  │
│ (loop)      │──▶ (one-shot)  │      │  (web UI)   │
└─────────────┘  └──────┬──────┘      └─────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐    ┌─────▼─────┐   ┌─────▼─────┐
   │ scrapers│    │ ai router │   │ adapters  │
   │ /<site> │    │ + scoring │   │ /<site>   │
   └────┬────┘    └─────┬─────┘   └─────┬─────┘
        │               │               │
        └───────────────┴───────────────┘
                        │
                ┌───────▼────────┐
                │ profile store  │
                │ (json + sqlite)│
                └────────────────┘
```

- **Scrapers** discover jobs (`src/scrapers/<site>.js`).
- **AI router** scores them (`src/aiRouter.js`) — local lexical first, then optional provider call.
- **Adapters** drive the actual apply form (`src/adapters/<site>.js`); generic form-fill is the fallback.
- **Scheduler** loops the pipeline on `SCHEDULER_INTERVAL_MS` on the user's machine or self-hosted worker.
- **Terminal dashboard** reads local state. The optional hosted dashboard syncs safe job metadata only.
- **Telegram bot** posts notifications and can stage approved jobs back into the local pipeline.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for adding new scrapers and adapters.

---

## Background mode (PM2)

```bash
npm run bot:start      # starts the scheduler under PM2
npm run bot:logs       # tail
pm2 save               # persist across reboots
```

## Telegram Bot

Each user should connect their own Telegram bot locally. The hosted dashboard
does not need the bot token or chat ID.

```bash
jobpilot telegram --profile=<name>
```

The command validates the bot token from `@BotFather`, discovers the chat after
the user sends `/start`, writes the token/chat ID to `.env`, and can send a test
message. The bot supports `/reviews`, `/queue`, `/status`, `/sites`,
`/approve_top`, `/approve_all`, and inline approve/skip buttons.

---

## Hosted Dashboard

The hosted dashboard is optional. It is for account auth, review queues, analytics,
and approving/rejecting jobs from the web. It should not receive user AI provider
keys, CAPTCHA keys, resumes, browser cookies, or job-board credentials in the
standard open-source flow.

Use `jobpilot login` only if you want hosted dashboard sync. The CLI still runs
scraping, scoring, browser automation, and applying locally or inside your own
self-hosted worker.

The local HTTP dashboard server is dev/debug only. It is disabled by default in
the scheduler; set `JOBPILOT_LOCAL_DASHBOARD=true` if you specifically need it.

---

## Hosting (24/7)

JobPilot ships with a Dockerfile and config for the two easiest hosts.

### Railway

```bash
# One-time:
railway login
railway init
railway up
```

The repo's `railway.toml` builds from the Dockerfile, mounts a persistent
volume at `/app/data`, and runs `node cli.js scheduler` as the start command.
Set your secrets in **Project → Variables**:

```
AI_PROVIDER=gemini
GEMINI_API_KEY=...
CAPSOLVER_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
SCHEDULER_INTERVAL_MS=14400000
JOBPILOT_REQUIRE_AUTH=false
```

You also need to upload your `profiles/` directory and resume PDF once
(Railway → **Volumes → Browse** or `railway volume mount`). Without those
files the scheduler has nothing to run for.

### Render

Push the repo with `render.yaml`, then in the Render dashboard:
**New → Blueprint → pick this repo**. Render reads `render.yaml`, creates a
Background Worker (Docker), provisions a 1 GB Disk at `/app/data`, and
prompts for the secret env vars. Background workers don't expose an HTTP
port — perfect for the scheduler.

### GitHub Actions

The GitHub workflow in this repo is CI only. Do not run applicant automation
from a public repository: profile state, resumes, browser artifacts, logs, and
application history can leak through commits, caches, or workflow artifacts.

Use a local machine, a private VPS, Railway, Render, or another controlled
worker for real scraping and applying. Keep profile folders, `.env`, resumes,
CAPTCHA keys, Telegram tokens, and job-board credentials outside public git.

### Plain Docker / VPS

```bash
docker build -t jobpilot .
docker run -d --name jobpilot \
  --restart unless-stopped \
  -v /srv/jobpilot/data:/app/data \
  -v /srv/jobpilot/profiles:/app/profiles \
  -v /srv/jobpilot/logs:/app/logs \
  --env-file .env \
  jobpilot
```

### Sizing

Playwright + Chromium needs **≥ 1 GB RAM** to be comfortable. Render's
`starter` plan (512 MB) works for short runs but will OOM on large scrapes —
bump to `standard` if you see crashes. Railway autoscales fine.

CAPTCHA solving still costs money on any host. Set a low
`MAX_AUTO_APPLY_PER_RUN` until you've watched a few runs.

---

## Tests

```bash
npm test                                  # unit + adapter test mode
npm run scrapers:check                    # static scraper / config validation
RUN_BROWSER_TESTS=1 npm run test:browser  # Playwright flows
RUN_LIVE_SCRAPER_TESTS=1 npm run test:scrapers:live  # hits real sites
```

Browser and live tests are opt-in so CI and first-run setups don't hang.

---

## Troubleshooting

**The browser opens but nothing happens.** Set `HEADLESS=false` in `.env` and re-run — you'll see exactly where the flow stops. 90 % of issues are obvious from the rendered page.

**CAPTCHA solves but Submit never fires.** Some hosted forms update their submitted state late. Applications may still go through; check the applicant email inbox to confirm. The job will land in `manual_review` rather than `applied`.

**RemoteOK or RemoteJobs.org found a company apply page but did not submit.** Gateway handoff is off by default. Run with `--allow-gateway-submit` or set `ALLOW_GATEWAY_AUTO_SUBMIT=true` after dry-run testing. Known but unaudited ATS platforms such as Lever, Workable, Ashby, SmartRecruiters, Workday, and BambooHR still route to manual review.

**Wizard can't find my resume.** Use an absolute path. Supported formats: `.pdf`, `.docx`, `.txt`.

**Same job applied to twice.** Cross-profile dedupe is on by default. If you intentionally want both profiles to apply, set `ALLOW_DUPLICATE_JOBS=true`. Otherwise check `profiles/<name>/processedJobs.json` for the dupe entry — it's usually a hash collision from a URL change on the site side.

**Gemini quota exceeded.** Free tier is generous but finite. Switch `AI_PROVIDER=openrouter` or `groq`, or raise `GEMINI_MIN_LOCAL_SCORE` so fewer jobs reach the AI tier.

**Tell me everything that's wrong:** `node cli.js doctor`.

---

## Safety defaults

- Local matcher runs before AI — keeps costs and noise down.
- Auto-apply is **off** at install. Enabled per-profile only when you say so.
- Test mode fills forms without submitting until you flip `TEST_MODE=false`.
- CAPTCHA or uncertain forms route to manual review rather than blindly submitting.
- Gateway sites only auto-handoff to audited adapters when `ALLOW_GATEWAY_AUTO_SUBMIT=true`.
- `KILL_SWITCH_DISABLE_AUTO_APPLY=true` instantly halts all submissions across all profiles.
- `NO_REAL_SUBMISSION=true` is the hard belt-and-braces: browser still drives the form but never clicks the final button.

---

## Roadmap

The current roadmap lives in [ROADMAP.md](ROADMAP.md). The near-term focus is:

- Safer public onboarding and release checks.
- Better audited apply adapters for common ATS platforms.
- Stronger dashboard review flows without collecting user secrets.
- More scraper health checks and contributor-friendly platform docs.

PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)
