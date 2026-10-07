# Continue: Lever scraper + real application

## Goal
Ship the Lever scraper and adapter, and send **one real job application** through `jobs.lever.co` using the `sister` profile.

## Already done
- `src/scrapers/lever.js` — `LeverScraper` parses listings from `<a class="posting-title">`.
- `src/scrapers/index.js` — `lever` registered in `scraperRegistry`.
- `config/sites.json` + `src/config.js` — `lever` site config (disabled by default, boards: `["stripe", "notion"]`).
- `src/adapters/lever.js` — fills standard fields, EEO radio groups, selects, and custom textareas; runs pre-submit required-field audit.
- `scripts/test-lever-real-apply.mjs` — real-application test harness.
- Telegram fixes + daily summary bulk-approve buttons (separate, completed).
- Fixed `src/captchaSolver.js` `detectCaptchaType` so hCaptcha is detected before the generic `data-sitekey` check.
- Added hCaptcha `checksiteconfig` route interception in `src/automation.js` to capture `rqdata` for CapSolver enterprise tasks.

## Current blocker
The SonarSource "Customer Success Engineer" job (`https://jobs.lever.co/sonarsource/5167622c-536c-4fa3-9cc5-24fe470918ad/apply`) uses **hCaptcha secure-api.js**. The configured CapSolver account rejects both:
- `HCaptchaTaskProxyless` → `ERROR_INVALID_TASK_DATA: We don't support this service`
- `HCaptchaEnterpriseTaskProxyless` → `ERROR_INVALID_TASK_DATA: This service is not supported`

`CaptchaSolv` is only used for reCAPTCHA v2, so it cannot help here. Manual non-headless solve was attempted twice; the user closed the browser the first time and the second attempt timed out.

## Next steps (pick one)
1. **Find a different Lever board that uses reCAPTCHA v2 or no CAPTCHA** and rerun `scripts/test-lever-real-apply.mjs` with that board. The `sister` profile should target a customer-success/support/operations role if possible.
   - Env override: `LEVER_TEST_BOARD=<board> node scripts/test-lever-real-apply.mjs`
   - Note: common boards (`stripe`, `notion`, `shopify`, `airbnb`, `twilio`, etc.) returned 0 jobs in the current scraper; SonarSource is the only board with live listings so far.
2. **Add a different CAPTCHA solver** that supports hCaptcha secure/enterprise (e.g. 2captcha / Anti-Captcha / NextCaptcha). Add its API key to `.env` and extend `src/captchaSolver.js` to try it for hCaptcha before giving up.
3. **Run a manual non-headless attempt** with a longer window (already configured in `test-lever-real-apply.mjs`) and ensure the user solves the checkbox before timeout.

## Key files
- `src/scrapers/lever.js`
- `src/scrapers/index.js`
- `src/adapters/lever.js`
- `src/automation.js` (hCaptcha route interception)
- `src/captchaSolver.js` (CAPTCHA detection + CapSolver call)
- `scripts/test-lever-real-apply.mjs`
- `config/sites.json`

## Verify success with
```bash
node scripts/test-lever-real-apply.mjs
```
Expected output: `✅ Lever application sent successfully.` and `application_lifecycle.json` ending in `APPLIED_SUCCESSFULLY` / `SUBMITTED`.
