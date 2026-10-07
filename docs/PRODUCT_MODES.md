# JobPilot Product Modes

JobPilot should stay local-first even as the project grows. The open-source
release has three supported modes.

## 1. Local-First CLI

This is the default mode for most users.

Runs on the user's computer:

- Profile setup and resume parsing
- Job scraping and scoring
- Browser automation and form filling
- CAPTCHA solving
- Telegram notifications
- Local history and review queues

Stores locally:

- Resumes and profile files
- AI provider keys
- CAPTCHA keys
- Telegram bot token and chat ID
- Browser profiles, cookies, logs, and job history

Recommended commands:

```bash
jobpilot init
jobpilot doctor --profile=<name>
jobpilot run --profile=<name>
jobpilot scheduler --profile=<name>
jobpilot dashboard
```

## 2. Personal Self-Hosted Runner

This is the same CLI running in a private worker that the user controls, such as
Railway, Render, Fly.io, a VPS, or Docker on a home server.

The runner still belongs to the user. It should use a private volume for
profiles and logs, for example `/app/data` in Docker/Railway.

Good for:

- 24/7 scheduling
- Multiple profiles
- Telegram approvals while away from the local machine
- Users comfortable managing environment variables and private storage

Not for:

- A shared public runner that stores many users' resumes and secrets
- Running browser automation from a public GitHub Actions workflow

## 3. Hosted Dashboard

The hosted dashboard is optional. It should be a control and visibility layer,
not the default automation runner.

It can store safe metadata:

- Job title, company, source, URL
- Score, status, decision, timestamps
- Profile display name or profile ID
- Review decisions such as approve/reject

It should not store by default:

- Resumes or CV text
- AI provider keys
- CAPTCHA keys
- Telegram bot tokens
- Job-board credentials
- Browser profiles, cookies, or raw debug artifacts

The local or self-hosted runner can sync safe metadata to the dashboard, pull
review decisions back down, and apply only from the user's trusted environment.

## Later Cloud/SaaS Mode

A fully hosted service can be built later, but it is a separate product with a
larger privacy, security, cost, and compliance burden. It would need managed
profile storage, user consent, billing/top-ups, audit logs, abuse controls, and
strong data deletion flows.

Until then, the open-source product should make the local/self-hosted path feel
excellent and let users bring their own AI key.
