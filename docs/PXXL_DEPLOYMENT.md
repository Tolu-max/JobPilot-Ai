# Deploying JobPilot Web To Pxxl

This guide is for the hosted website and dashboard only. Do not deploy the
local automation runner, real profiles, resumes, browser sessions, provider
keys, CAPTCHA keys, Telegram tokens, or job-board credentials to a public web
host.

## What To Deploy

Deploy the Next.js app in:

```bash
website
```

The CLI remains local-first:

```bash
jobpilot run --profile=<profile> --limit 50 --review-first
jobpilot scheduler --profile=<profile>
```

## Pxxl Project Settings

Use these settings when creating the hosted app:

| Setting | Value |
|---|---|
| App root / project directory | `website` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Start command | `npm run start` |
| Node version | `20` or newer |

If Pxxl asks for a repository root, use the Git repository root. If it asks for
an app directory, use `website`.

## Environment Variables

Create these in Pxxl from `website/.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

These are public browser variables. They are still backed by Supabase Row Level
Security, so confirm the SQL policies are installed before inviting users.

Do not add these to Pxxl:

```bash
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
CAPSOLVER_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
APPLICANT_PASSWORD=
JOB_BOARD_PASSWORD=
```

Those belong in the user's local `.env` or private worker only.

## Supabase Setup

1. Run `src/api/schema.sql` in the Supabase SQL editor.
2. Enable GitHub and/or Google OAuth providers in Supabase Auth.
3. Add these redirect URLs in Supabase:

```text
https://<your-pxxl-domain>/auth/callback
http://localhost:3000/auth/callback
```

4. Keep Row Level Security enabled on `profiles` and `job_applications`.

The dashboard reads and writes safe metadata only: job title, company, score,
status, source, timestamps, and profile labels.

## CLI Login Flow

After the web app is live, users can connect the CLI:

```bash
jobpilot login
```

The CLI opens the hosted login page, completes OAuth, then passes the session
back to a temporary local callback server. The hosted app does not need the
user's AI provider keys, CAPTCHA keys, resume, cookies, or Telegram token.

## Before Publishing The Repo

Run:

```bash
npm --prefix website run lint
npm --prefix website run build
npm run release:check
```

`npm run release:check` must pass before a public push. If it fails because
private resumes, audio files, or real profiles are still inside the repo folder,
move those files outside the repository and run it again.
