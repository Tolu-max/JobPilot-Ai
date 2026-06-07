// Ashby ATS adapter — fill + submit for jobs hosted on jobs.ashbyhq.com.
//
// Ashby serves the application form directly at
// jobs.ashbyhq.com/<company>/<jobId>/application — no "Apply" click needed.
// Standard fields: name (single), email, phone, location, resume upload,
// LinkedIn URL, cover-letter textarea. Custom questions vary by company.
//
// Safety: the adapter fills everything it can confidently answer. Required
// unknown fields are checked before submit — if any required field is still
// empty, the adapter bails to manual review rather than guessing.

import { FormStep, Proof, noProof, proofFound } from './types.js';
import { reactFill, checkAllRadioGroups, auditRequiredFields, firstPhone } from './atsFormHelpers.js';

const NAME = 'ashby';
const APPLY_FORM_URL = /\/application(\?|$)/;
const SUBMITTED_TEXT = /application submitted|thank you for (applying|your application)|we.?ll be in touch/i;
const SUBMITTED_URL = /\/success|\/confirm|\/submitted/i;

function matches(url) {
  return /jobs\.ashbyhq\.com|app\.ashbyhq\.com/i.test(String(url || ''));
}

// ── step detection ──────────────────────────────────────────────────────────

async function getCurrentStep(page) {
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  if (SUBMITTED_TEXT.test(body)) return FormStep.SUBMITTED;
  if (SUBMITTED_URL.test(url)) return FormStep.SUBMITTED;

  if (APPLY_FORM_URL.test(url)) return FormStep.DETAILS;

  return FormStep.UNKNOWN;
}

// ── fill ────────────────────────────────────────────────────────────────────

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  // No Apply click needed — the /application URL is the form directly. If we
  // somehow landed on the listing page, follow the Apply link to the form.
  if (!APPLY_FORM_URL.test(page.url())) {
    const applyBtn = page.getByRole('link', { name: /apply for this job|apply now|apply/i }).first()
      .or(page.getByRole('button', { name: /apply for this job|apply now|apply/i }).first());
    if (await applyBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await applyBtn.click({ force: true });
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }

  // Ashby lazy-mounts the application form fields a while after the page's
  // initial load — the URL is /application immediately, but the inputs render
  // only once the form hydrates. Wait for the system Name/Email field to attach
  // before filling, otherwise every reactFill no-ops against an empty DOM.
  await page.locator('input[name="_systemfield_name"], input[name="_systemfield_email"], input[type="email"]')
    .first()
    .waitFor({ state: 'attached', timeout: 20000 })
    .catch(() => {});

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const fullName = candidate.name || defaults.fullName || '';
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const location = defaults.country || candidate.location || '';
  const linkedin = candidate.linkedin || candidate.portfolioLinks?.linkedin || defaults.linkedinProfileUrl || '';

  // Resume upload — Ashby's resume input has id _systemfield_resume.
  if (ctx.resumePath) {
    const fileInput = page.locator('input[type="file"]#_systemfield_resume, input[type="file"]').first();
    if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileInput.setInputFiles(ctx.resumePath, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }

  // Ashby uses stable names only for the system Name/Email fields; phone,
  // LinkedIn and location carry per-job UUID names, so target those by input
  // type or visible label instead.
  await reactFill(page, 'input[name="_systemfield_name"]', fullName);
  await reactFill(page, 'input[name="_systemfield_email"], input[type="email"]', email);
  await reactFill(page, 'input[type="tel"]', phone);
  await reactFill(page, page.getByLabel(/linkedin/i), linkedin);
  await reactFill(page, page.getByLabel(/country|location|where are you/i), location);
  // Cover letter / notes: only fill when one was pre-generated.
  if (ctx.coverLetter) {
    await reactFill(page, 'textarea[name*="cover" i], textarea[name*="notes" i]', ctx.coverLetter);
  }

  await checkAllRadioGroups(page);

  await page.waitForTimeout(500);
}

// ── advance (submit) ────────────────────────────────────────────────────────

async function advance(page, step, ctx) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Ashby form filled and stopped before submit.'
    };
  }

  const audit = await auditRequiredFields(page);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `Ashby pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  const submit = page.locator('button[type="submit"], button:has-text("Submit application"), button:has-text("Submit")').first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'Ashby submit button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'Ashby submit button is disabled; required fields may be missing.' };
  }

  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await submit.click({ force: true });
  await page.waitForTimeout(6000);

  const submitted = await isSubmitted(page);
  return {
    step: submitted.submitted ? FormStep.SUBMITTED : FormStep.REVIEW,
    advanced: submitted.submitted,
    reason: submitted.reason || submitted.markers?.join(', ') || ''
  };
}

// ── submission detection ────────────────────────────────────────────────────

async function isSubmitted(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const url = page.url();
  const markers = [];
  if (SUBMITTED_TEXT.test(body)) {
    markers.push(`Ashby confirmation text detected: "${body.match(SUBMITTED_TEXT)?.[0]}"`);
  }
  if (SUBMITTED_URL.test(url)) {
    markers.push(`Ashby confirmation URL: ${url}`);
  }
  return markers.length ? proofFound(markers) : noProof('No Ashby confirmation detected.');
}

async function verifySubmission() {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Ashby has no safe generic independent re-verification configured yet.'
  };
}

// ── export ──────────────────────────────────────────────────────────────────

export const ashbyAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default ashbyAdapter;
