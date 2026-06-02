# Security Policy

## Reporting Security Issues

Please do not open public issues for security vulnerabilities or leaked secrets.

Email the maintainer or use a private disclosure channel if one is configured for the repository. Include:

- A short summary.
- Affected area: CLI, scraper, adapter, dashboard, Telegram, Supabase sync, or dependency.
- Reproduction steps.
- Impact.
- Suggested mitigation, if known.

## Sensitive Data Rules

Never commit:

- `.env` or `.env.*` except `.env.example`.
- AI provider keys.
- CAPTCHA solver keys.
- Telegram bot tokens or chat IDs.
- Job-board credentials.
- Resumes, CVs, audio/video recordings, screenshots, cookies, browser profiles, or private applicant files.
- Private `profiles/<name>/` folders.

## Hosted Dashboard Boundary

The hosted dashboard should not collect user provider keys, CAPTCHA keys, resumes, Telegram bot tokens, browser cookies, or job-board passwords in the default open-source path.

## Supported Versions

The project is early-stage. Use the latest commit on `main` unless a tagged release exists.
