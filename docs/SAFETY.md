# Safety and Responsible Use

JobPilot automates parts of a job search. Use it carefully.

## Core Rules

- Do not submit applications with false claims.
- Do not bypass a job board's rules or access controls.
- Do not run live submit on an application flow that has not been audited.
- Do not store provider keys, CAPTCHA keys, Telegram tokens, resumes, cookies, or job-board passwords in a hosted dashboard by default.
- Keep unknown ATS platforms in manual review until the resolver and adapter are tested.

## Recommended Public Defaults

For open-source users and contributors:

- `AUTO_APPLY=false`
- `TEST_MODE=true`
- `NO_REAL_SUBMISSION=true` during testing
- `ALLOW_GATEWAY_AUTO_SUBMIT=false`
- `MAX_AUTO_APPLY_PER_RUN=1`
- Review-first queues for new platforms

Private users can intentionally opt into faster or live automation in their own ignored profile files.

## Application Accuracy

AI-generated screening answers must be grounded in the candidate's resume, profile, and configured application defaults. If JobPilot cannot answer a question honestly, it should leave the role for manual review or use a conservative answer.

## CAPTCHA

CAPTCHA solving is optional and user-owned. Users pay their provider directly and keep the solver key local.

## Hosted Dashboard Boundary

The hosted dashboard should handle auth, review, status, analytics, and safe metadata. The local runner should handle scraping, scoring, browser automation, resumes, provider keys, CAPTCHA keys, browser profiles, and job-board credentials.
