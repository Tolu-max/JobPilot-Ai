// Workable ATS adapter — fill + submit for jobs hosted on apply.workable.com.
//
// Workable renders a single-page React form reached after clicking "Apply for
// this job" on the listing page (apply.workable.com/<company>/j/<jobId>). The
// form URL contains /candidate/new. Standard fields: firstname, lastname
// (SEPARATE — unlike Lever's single name), email, phone, address (location),
// summary textarea (cover letter), resume upload, LinkedIn/Portfolio URLs, plus
// employer-specific EEO/demographic radio groups (UUID-keyed, like Lever).
//
// Safety: the adapter fills everything it can confidently answer. Required
// unknown fields are checked before submit — if any required field is still
// empty, the adapter bails to manual review rather than guessing.

import { FormStep, Proof, noProof, proofFound } from './types.js';
import { reactFill, checkAllRadioGroups, auditRequiredFields, splitName, firstPhone } from './atsFormHelpers.js';

const NAME = 'workable';
// The application form lives at <listing>/apply/ (verified against live
// apply.workable.com forms — the older /candidate/new path is not used).
const APPLY_FORM_URL = /\/apply\/?(\?|$)/;
const SUBMITTED_TEXT = /your application has been submitted|application (was|is) submitted|thanks for applying/i;
const SUBMITTED_URL = /\/confirm|\/success|\/thank-you/i;

function matches(url) {
  return /apply\.workable\.com/i.test(String(url || ''));
}

// ── step detection ──────────────────────────────────────────────────────────

async function getCurrentStep(page) {
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  if (SUBMITTED_TEXT.test(body)) return FormStep.SUBMITTED;
  if (SUBMITTED_URL.test(url)) return FormStep.SUBMITTED;

  if (APPLY_FORM_URL.test(url)) return FormStep.DETAILS;

  return FormStep.UNKNOWN; // listing page
}

// ── fill ────────────────────────────────────────────────────────────────────

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  // Navigate to the /apply/ form if we're still on the listing page.
  if (!APPLY_FORM_URL.test(page.url())) {
    const applyBtn = page.getByRole('link', { name: /apply for this job|apply now|apply/i }).first()
      .or(page.getByRole('button', { name: /apply for this job|apply now|apply/i }).first());
    if (await applyBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await applyBtn.click({ force: true }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    // Fallback: the apply form URL is deterministically <listing>/apply/.
    // If the click didn't navigate (SPA quirk / overlay), go there directly.
    if (!APPLY_FORM_URL.test(page.url())) {
      const applyUrl = page.url().replace(/\/+$/, '') + '/apply/';
      await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const fullName = candidate.name || defaults.fullName || '';
  const { first, last } = splitName(fullName);
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const location = defaults.country || candidate.location || '';
  const linkedin = candidate.linkedin || candidate.portfolioLinks?.linkedin || defaults.linkedinProfileUrl || '';

  // Resume upload — Workable's file input is usually name*="resume".
  if (ctx.resumePath) {
    const fileInput = page.locator('input[type="file"][name*="resume" i], input[type="file"]').first();
    if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileInput.setInputFiles(ctx.resumePath, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }

  await reactFill(page, 'input[name="firstname"]', first);
  await reactFill(page, 'input[name="lastname"]', last);
  await reactFill(page, 'input[name="email"]', email);
  await reactFill(page, 'input[name="phone"]', phone);
  await reactFill(page, 'input[name="address"]', location);
  await reactFill(page, 'input[name="country"]', defaults.country || candidate.location || '');
  // Cover-letter summary: only fill when a cover letter was pre-generated.
  if (ctx.coverLetter) {
    await reactFill(page, 'textarea[name="summary"], input[name="summary"]', ctx.coverLetter);
  }
  await reactFill(page, 'input[placeholder*="linkedin" i], input[name*="linkedin" i]', linkedin);

  await checkAllRadioGroups(page);

  await page.waitForTimeout(500);
}

// ── advance (submit) ────────────────────────────────────────────────────────

async function advance(page, step, ctx) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Workable form filled and stopped before submit.'
    };
  }

  const audit = await auditRequiredFields(page);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `Workable pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  const submit = page.locator('button[type="submit"]:has-text("Submit"), button[type="submit"], button:has-text("Submit application")').first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'Workable submit button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'Workable submit button is disabled; required fields may be missing.' };
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
    markers.push(`Workable confirmation text detected: "${body.match(SUBMITTED_TEXT)?.[0]}"`);
  }
  if (SUBMITTED_URL.test(url)) {
    markers.push(`Workable confirmation URL: ${url}`);
  }
  return markers.length ? proofFound(markers) : noProof('No Workable confirmation detected.');
}

async function verifySubmission() {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Workable has no safe generic independent re-verification configured yet.'
  };
}

// ── export ──────────────────────────────────────────────────────────────────

export const workableAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default workableAdapter;
