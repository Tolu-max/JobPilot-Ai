# JobPilot Release Checklist

Use this before pushing the public open-source repository or cutting a release.

## 1. Confirm Public Defaults

- `.env.example` has `AUTO_APPLY=false`, `TEST_MODE=true`, and `NO_REAL_SUBMISSION=true`.
- `profiles/example/preferences.json` is dry-run and review-first.
- Real profile folders stay ignored by git.
- No scheduler workflow runs applicant automation in GitHub Actions.

## 2. Remove Private Material From The Repo Folder

Ignored files can still be leaked by accident when copying, zipping, or changing
git rules. Before a public push, move these outside the repository:

- `.env`
- Real resumes, PDFs, DOCX files, and audio recordings.
- `profiles/<real-user>/`
- Browser profile folders and session cookies.
- Logs, debug screenshots, and traces.

## 3. Run Checks

```bash
node --check src/cli/onboarding.js
node --check src/config.js
node --check src/pipeline.js
node --check src/jobApplicationSync.js
node --check src/dashboardSync.js
node --check src/profileSync.js
node --check src/api/db.js
npm test
npm run scrapers:check
cd website
npm run lint
npm run build
cd ..
npm run release:check
```

## 4. Review Git State

```bash
git status --short
git diff -- . ":(exclude)profiles/sister" ":(exclude)profiles/tolu"
```

Only public source, docs, examples, and templates should be staged.

## 5. Final Safety Pass

- Search for private emails, phone numbers, API keys, passwords, and local paths.
- Confirm docs say review-first by default.
- Confirm any live-submit adapter is audited and tested in dry-run mode first.
- Confirm unknown ATS flows route to manual review.
