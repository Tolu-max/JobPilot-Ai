# JobPilot Automation Runbook

This is the recommended operating model for comfortable, safer job automation.

## 1. Keep the Runner Local

Run scraping, scoring, CAPTCHA solving, browser sessions, resume uploads, and real submit from the CLI on a trusted machine:

```bash
jobpilot doctor --profile=<profile>
jobpilot run --profile=<profile> --limit 50 --review-first
jobpilot scheduler --profile=<profile>
```

The hosted dashboard should remain a review and analytics layer. It can approve work, but it should not store secrets or drive the browser itself.

## 2. Use Review-First as the Default

Every role should pass these gates before live submit:

- The job is fresh enough.
- The role matches the profile and score threshold.
- Location rules pass.
- Duplicate and cross-profile checks pass.
- The job is not excluded by known profile constraints.
- The user or profile approved it.
- The apply flow is audited.
- CAPTCHA handling is available locally if the form requires it.

If any gate is uncertain, keep the job in manual review.

## 3. Separate Source Scraping From Applying

Source boards such as RemoteOK, RemoteJobs.org, Himalayas, Remotive, and similar sites may redirect to company pages. Treat this as two steps:

1. Scrape and score the source listing.
2. Resolve the final apply target and classify the apply system.

Only audited handlers should submit real applications. Unknown ATS platforms should be opened for manual review or routed to a safe fallback that does not click submit.

## 4. Recommended Daily Flow

```bash
jobpilot doctor --profile=<profile>
jobpilot run --profile=<profile> --limit 50 --review-first
jobpilot review --profile=<profile>
jobpilot scheduler --profile=<profile>
```

For Telegram:

```bash
jobpilot telegram --profile=<profile>
```

For dashboard sync:

```bash
jobpilot login
```

## 4.1 Continuous Automation Loop

For a hands-off runner, start the scheduler:

```bash
jobpilot scheduler
```

With no `--profile`, the scheduler loads every profile under `profiles/` except `example`.

The public example defaults are intentionally conservative:

- Scheduler tick: every 4 hours (`14400000` ms).
- Auto-apply is off.
- Test mode and `NO_REAL_SUBMISSION` are on.
- Gateway auto-submit is off.

Private profiles can set a faster interval after dry-run testing. For example,
`schedulerIntervalMs: 180000` runs every 3 minutes.

Each tick pulls dashboard approvals, flushes approved local jobs, scrapes enabled
sites, scores new jobs, stores results locally, and syncs Supabase when
configured.

`maxAutoApplyPerRun: 0` means no per-run apply cap, but only for profiles that
explicitly choose that setting. The fit checks, duplicate checks, hard filters,
site `autoApplyEnabled`, and audited apply-flow gates still apply.

Local storage is always written to profile JSON and SQLite at `data/job-applications.db`. Supabase sync is best-effort and only runs when the CLI is logged in or when service-role sync is explicitly configured with a real `SUPABASE_USER_ID`.

## 5. Server / Worker Options

Comfortable automation can run on:

- A local computer that stays on.
- A trusted VPS with Chromium/Playwright support.
- A controlled worker where the user owns the environment variables and profile files.

The hosted web app can live on a platform such as `pxxl.app`, but the browser runner should only run there if the environment is private, supports headless browser automation, and the user accepts that their local secrets live there.

## 6. Open Source Contributor Rule

When adding a platform:

- Add scraper tests or health checks.
- Prove recency filtering.
- Prove duplicate handling.
- Prove location/profile filtering.
- Audit the apply flow before enabling live submit.
- Keep the default behavior in review mode until the source is trusted.

## 7. What the Dashboard Should Show

The dashboard should focus on:

- Review queue.
- Source performance.
- Runner status and commands.
- Application history.
- Safe profile settings.
- Setup docs and local-first boundaries.

It should not collect provider keys, resumes, Telegram bot tokens, job-board passwords, browser cookies, or CAPTCHA secrets.
