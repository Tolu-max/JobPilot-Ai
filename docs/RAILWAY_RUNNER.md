# Running JobPilot On Railway

Use Railway only for a private runner. Keep the public Pxxl app as the hosted
dashboard, and keep this Railway service private.

## Recommended Mode For Low Credits

With small credits, prefer Railway's cron/scheduled job mode:

```bash
node scripts/run-all-profiles-once.mjs
```

That command processes every real profile under `profiles/`, then exits. It is
better for a small budget than a container that sleeps all day.

Suggested schedule while testing:

```text
Every 15-30 minutes
```

Every 3 minutes works technically, but it can burn provider/CAPTCHA quota and
can trigger anti-bot pressure on job sites.

## Always-On Mode

If you want a constantly running worker, use the default Railway command:

```bash
node cli.js scheduler
```

The existing `railway.toml` uses this mode. It is simpler, but it consumes
Railway resources even while waiting between scheduler ticks.

## Required Railway Settings

Use the root project, not the `website` folder:

| Setting | Value |
|---|---|
| Builder | Dockerfile |
| Dockerfile | `Dockerfile` |
| Start command | `node cli.js scheduler` |
| Cron command option | `node scripts/run-all-profiles-once.mjs` |
| Volume mount | `/app/data` |

The Docker entrypoint links these paths into the persistent `/app/data` volume:

```text
/app/profiles
/app/logs
/app/review
/app/debug
/app/browser-profiles
/app/test-results
```

## Upload Private Profile Files

Because real profiles and resumes are gitignored, Railway will not receive them
from the repository. Upload them into the volume:

```text
/app/data/profiles/tolu/preferences.json
/app/data/profiles/tolu/candidateProfile.json
/app/data/profiles/tolu/resume.pdf
/app/data/profiles/sister/preferences.json
/app/data/profiles/sister/candidateProfile.json
/app/data/profiles/sister/resume.pdf
```

Keep private audio files beside the profile if the profile references them:

```text
/app/data/profiles/sister/Influx.m4a
```

## Required Environment Variables

Set only private runner variables on Railway:

```bash
HEADLESS=true
TEST_MODE=false
NO_REAL_SUBMISSION=false
AUTO_APPLY=true
GEMINI_API_KEY=
CAPSOLVER_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
JOBPILOT_API_URL=https://<your-dashboard-domain>
```

Add profile-specific credentials only when the matching site is enabled:

```bash
TOLU_APPLICANT_EMAIL=
SISTER_APPLICANT_EMAIL=
```

Do not put these values in the public repository.

## First Test

Start safely:

```bash
TEST_MODE=true
NO_REAL_SUBMISSION=true
node scripts/run-all-profiles-once.mjs
```

After reviewing logs and dashboard sync, switch to live mode only for the
profiles and sources you trust.
