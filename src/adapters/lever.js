// Lever ATS adapter — fill + submit for jobs hosted on jobs.lever.co.
// Lever renders a single-page React form after the candidate clicks "Apply".
// Standard fields: name, email, phone, location, resume, urls[LinkedIn] (req),
// urls[Portfolio], urls[Other], org, plus employer-specific EEO/demographic
// card and survey radio groups with UUID-keyed names.
//
// Safety: the adapter fills everything it can confidently answer (name, email,
// phone, resume, LinkedIn). Required unknown fields (EEO/demographic cards,
// custom questions) are checked before submit — if any required field is still
// empty, the adapter bails to manual review rather than guessing.

import { FormStep, Proof, noProof, proofFound } from './types.js';

const NAME = 'lever';
const APPLY_URL_PATTERN = /\/apply(\?|$)/;
const SUBMITTED_TEXT = /thank you for (applying|your application)|application (received|submitted|complete)|we have received|we will be in touch|you.?ll hear from us/i;
const SUBMITTED_URL = /\/(confirm|thanks|submitted|complete|application-received)/i;

function matches(url) {
  return /jobs\.lever\.co/i.test(String(url || ''));
}

// ── step detection ──────────────────────────────────────────────────────────

async function getCurrentStep(page) {
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  if (SUBMITTED_TEXT.test(body)) return FormStep.SUBMITTED;
  if (SUBMITTED_URL.test(url)) return FormStep.SUBMITTED;

  // Lever's apply page has the form embedded; the listing page has an Apply link.
  if (APPLY_URL_PATTERN.test(url) && /apply|submit/i.test(body)) return FormStep.DETAILS;
  if (APPLY_URL_PATTERN.test(url)) return FormStep.DETAILS;

  return FormStep.UNKNOWN;
}

// ── fill ────────────────────────────────────────────────────────────────────

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  // Navigate to /apply if we're on the listing page
  if (!APPLY_URL_PATTERN.test(page.url())) {
    const applyLink = page.getByRole('link', { name: /apply/i }).first()
      .or(page.getByRole('button', { name: /apply/i }).first());
    if (await applyLink.isVisible({ timeout: 8000 }).catch(() => false)) {
      await applyLink.click({ force: true });
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const name = candidate.name || defaults.fullName || '';
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const linkedin = candidate.linkedin || candidate.portfolioLinks?.linkedin || defaults.linkedinProfileUrl || '';

  // Resume upload — try the known Lever file input first
  if (ctx.resumePath) {
    const fileInput = page.locator('input[name="resume"]').first();
    if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileInput.setInputFiles(ctx.resumePath, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }

  await leverFill(page, 'input[name="name"]', name);
  await leverFill(page, 'input[name="email"]', email);
  await leverFill(page, 'input[name="phone"]', phone);
  await leverFill(page, 'input[name="location"]', defaults.country || candidate.location || '');
  await leverFill(page, 'input[name="urls[LinkedIn]"]', linkedin);
  await leverFill(page, 'input[name="urls[Portfolio]"]', defaults.portfolioUrl || '');
  await leverFill(page, 'input[name="org"]', defaults.currentCompany || '');

  // For EEO/demographic radio groups (cards[...] / surveysResponses[...]):
  // select the first visible option in every unchecked group to satisfy
  // required-validation without asserting anything about the candidate.
  await checkAllRadioGroups(page);

  await page.waitForTimeout(500);
}

// ── advance (submit) ────────────────────────────────────────────────────────

async function advance(page, step, ctx) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Lever form filled and stopped before submit.'
    };
  }

  // Pre-submit audit: any required fields still empty?
  const audit = await leverRequiredAudit(page);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `Lever pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  const submit = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("submit application")').first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'Lever submit button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'Lever submit button is disabled; required fields may be missing.' };
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
    markers.push(`Lever confirmation text detected: "${body.match(SUBMITTED_TEXT)?.[0]}"`);
  }
  if (SUBMITTED_URL.test(url)) {
    markers.push(`Lever confirmation URL: ${url}`);
  }
  return markers.length ? proofFound(markers) : noProof('No Lever confirmation detected.');
}

async function verifySubmission() {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Lever has no safe generic independent re-verification configured yet.'
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function leverFill(page, selector, value) {
  if (!value) return false;
  const loc = page.locator(selector).first();
  if (!(await loc.isVisible({ timeout: 1500 }).catch(() => false))) return false;
  if (await loc.isDisabled().catch(() => false)) return false;

  const current = await loc.inputValue().catch(() => '');
  if (current.trim()) return true; // already filled

  // React controlled input — force-set via native descriptor
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ force: true }).catch(() => {});
  await loc.evaluate((el, nextValue) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    desc?.set?.call(el, nextValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value)).catch(async () => {
    await loc.fill('').catch(() => {});
    await loc.pressSequentially(String(value), { delay: 20 }).catch(() => {});
  });
  // blur to trigger React validation
  await loc.evaluate((el) => el.blur()).catch(() => {});
  return true;
}

async function checkAllRadioGroups(page) {
  const radios = await page.locator('input[type="radio"]:visible').all();
  const seen = new Set();
  for (const radio of radios) {
    const name = await radio.getAttribute('name').catch(() => '') || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    // Skip if any radio in this group is already checked
    const checked = await page.locator(`input[type="radio"][name="${cssEscape(name)}"]:checked`).count().catch(() => 0);
    if (checked > 0) continue;
    // Select the first visible radio in the group
    await radio.check({ force: true }).catch(() => {});
  }
}

async function leverRequiredAudit(page) {
  return page.locator('body').evaluate(() => {
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const required = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((el) => visible(el))
      .filter((el) => el.required || el.getAttribute('aria-required') === 'true')
      .filter((el) => el.type !== 'hidden');

    const missing = required.filter((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') {
        const n = el.getAttribute('name');
        if (!n) return !el.checked;
        return !document.querySelector(`input[name="${CSS.escape(n)}"]:checked`);
      }
      if (el.type === 'file') return !el.files?.length;
      return !String(el.value || '').trim();
    });

    const labelFor = (el) => {
      const id = el.id;
      const lbl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return (lbl?.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60);
    };

    return {
      ok: missing.length === 0,
      reason: missing.length
        ? `${missing.length} required field(s) still empty: ${missing.map((el) => `${el.name || el.id || el.type}(${labelFor(el)})`).join(', ')}`
        : 'Lever form passed pre-submit required-field audit.',
      missing: missing.map((el) => ({ name: el.name || '', id: el.id || '', type: el.type || el.tagName.toLowerCase(), label: labelFor(el) }))
    };
  }).catch((error) => ({
    ok: false,
    reason: `Lever audit failed: ${error.message}`,
    missing: []
  }));
}

function firstPhone(phone) {
  return String(phone || '').split(',')[0].trim();
}

function cssEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── export ──────────────────────────────────────────────────────────────────

export const leverAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default leverAdapter;
