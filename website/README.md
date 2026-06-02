# JobPilot Website

Next.js app for the optional hosted JobPilot dashboard.

The website is not the automation runner. It should only handle auth, review queues, analytics, and safe job metadata synced by the local CLI. Do not collect or store user AI keys, CAPTCHA keys, resumes, browser profiles, cookies, or job-board credentials here.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Use the root CLI for automation:

```bash
jobpilot init
jobpilot telegram --profile=<profile>
jobpilot login
jobpilot scheduler --profile=<profile>
```

## Dashboard Contract

- The CLI pushes safe job metadata: title, company, score, status, source, URL, profile, and timestamps.
- The dashboard writes review decisions: approved or rejected.
- The local scheduler pulls those decisions and applies only on the user's own machine or self-hosted worker.
