# JobPilot Roadmap

## Now

- Harden local-first onboarding.
- Keep public defaults dry-run and review-first.
- Improve source health checks for implemented scrapers.
- Expand dashboard pages for runner status, source performance, and review queues.

## Next

- Add more audited ATS adapters.
- Improve screening-question answer grounding.
- Add better fixture-based tests for each scraper.
- Improve profile import/export without private files.
- Add safer managed-worker documentation for advanced self-hosters.

## Later

- More platform integrations after scraper and apply-flow audits.
- Web onboarding that never collects local secrets by default.
- Contributor plugin model for scrapers/adapters.
- Hosted dashboard analytics for safe metadata only.

## Contribution Rules

- New sources start as scrape/review-only.
- Live submit requires tests and an audited apply flow.
- Unknown ATS, CAPTCHA, and login-gated flows must route to manual review.
