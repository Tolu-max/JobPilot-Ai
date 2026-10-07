import { FormStep, Proof, noProof, proofFound } from './types.js';
import { reactFill, auditRequiredFields, fillKnownRequiredFields, firstPhone } from './atsFormHelpers.js';

const NAME = 'breezyhr';
const CAREERS_URL = /\.breezy\.hr\/(?:p\/[a-zA-Z0-9_-]+|apply)(?:\/|\?|$)/i;
const SUBMITTED_TEXT = /thank you for applying|application submitted|your application has been submitted|your application has been received|we have received your application|thanks for applying/i;

function matches(url) {
  return CAREERS_URL.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (SUBMITTED_TEXT.test(body)) return FormStep.SUBMITTED;

  const nameInput = await page.locator('input[name="cName"], #cName').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  const emailInput = await page.locator('input[name="cEmail"], #cEmail').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  const fileInput = await page.locator('input[name="cResume"], input[type="file"]').first()
    .isVisible({ timeout: 1000 }).catch(() => false);

  if (nameInput || emailInput || fileInput) return FormStep.DETAILS;
  if (/apply for this job|apply now/i.test(body)) return FormStep.UNKNOWN;
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  const currentUrl = page.url();
  if (!currentUrl.includes('/apply')) {
    const applyBtn = page.locator('a[href*="/apply"], button:has-text("Apply")').first();
    if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const fullName = candidate.name || defaults.fullName || '';
  const email = ctx.config?.applicantEmail || candidate.email || defaults.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const address = defaults.address || (defaults.city && defaults.country ? `${defaults.city}, ${defaults.country}` : 'Nigeria');
  const summary =
    candidate.bio ||
    candidate.summary ||
    defaults.summary ||
    ctx.config?.userProfileSummary ||
    'Experienced specialist skilled in operations, customer support, CRM, and administrative tasks.';
  const coverLetter = ctx.coverLetter || defaults.coverLetter || '';
  const desiredSalary = defaults.desiredSalary && defaults.desiredSalary !== 'Negotiable'
    ? defaults.desiredSalary
    : (defaults.hourlyRate || '5');

  await uploadResume(page, ctx.resumePath);

  await reactFill(page, 'input[name="cName"], #cName', fullName);
  await reactFill(page, 'input[name="cEmail"], #cEmail', email);
  await reactFill(page, 'input[name="cPhoneNumber"], #cPhoneNumber', phone);
  await reactFill(page, 'input[name="cAddress"], #fullAddress', address);

  // Desired salary and pay frequency
  await reactFill(page, 'input[name="cSalary"], #cSalary', desiredSalary);
  const salarySelect = page.locator('select').first();
  if (typeof salarySelect.selectOption === 'function' && (await salarySelect.count().catch(() => 0))) {
    await salarySelect.selectOption({ value: 'hourly' }).catch(() => {
      return salarySelect.selectOption({ index: 0 }).catch(() => {});
    });
  }

  // Summary / bio
  await reactFill(page, 'textarea[name="cSummary"], #cSummary', summary);

  if (coverLetter) {
    await reactFill(page, 'textarea[name="cCoverLetter"], #cCoverLetter', coverLetter);
  }

  // Consent & GDPR checkboxes
  const consents = typeof page.locator('input').all === 'function'
    ? await page.locator('input[type="checkbox"][name*="consent" i], input[type="checkbox"][name*="gdpr" i], input[name="smsConsent"]').all().catch(() => [])
    : [];
  for (const cb of consents) {
    if (typeof cb.check === 'function') {
      await cb.check({ force: true }).catch(() => {});
    }
  }

  await page.waitForTimeout(1000);
}

async function answerQuestionnaireFields(page, ctx) {
  if (typeof page.evaluate !== 'function') return;
  const defaults = ctx.config?.applicationDefaults || {};

  // 1. Radio groups
  const radioGroups = await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]:not([type="hidden"])')).filter(
      (el) => el.offsetParent !== null
    );
    const names = [...new Set(radios.map((r) => r.name).filter(Boolean))];
    return names.map((name) => {
      const items = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)).map((el) => {
        const text =
          el.closest('label')?.innerText?.trim() ||
          el.parentElement?.innerText?.trim() ||
          el.value;
        const questionText = el.closest('.question, .section')?.innerText?.slice(0, 200) || '';
        return { value: el.value, text, questionText };
      });
      return { name, items };
    });
  }).catch(() => []);

  for (const group of radioGroups) {
    const qText = (group.items[0]?.questionText || '').toLowerCase();
    let targetOption = null;

    if (/va id/i.test(qText)) {
      targetOption = group.items.find((i) => /do not have|don't have|no/i.test(i.text)) || group.items[1];
    } else if (/other clients|work commitments|sponsorship|felony|crime|misdemeanor|non-compete/i.test(qText)) {
      targetOption = group.items.find((i) => /^no\b/i.test(i.text)) || group.items[1];
    } else {
      targetOption = group.items.find((i) => /^yes\b/i.test(i.text)) || group.items[0];
    }

    if (targetOption) {
      const locator = page.locator(`input[type="radio"][name="${group.name}"][value="${targetOption.value}"]`).first();
      await locator.check({ force: true }).catch(() => {});
    }
  }

  // 2. Text / Textarea inputs
  const textInputs = await page.locator('input[type="text"]:visible, textarea:visible').all().catch(() => []);
  for (const input of textInputs) {
    const name = await input.getAttribute('name').catch(() => '');
    if (name?.startsWith('hp_')) continue; // skip honeypot fields!
    const val = await input.inputValue().catch(() => '');
    if (val.trim()) continue;

    const label = (
      (await input.evaluate(
        (el) =>
          el.labels?.[0]?.innerText ||
          el.closest('label')?.innerText ||
          el.closest('.question, .section')?.innerText ||
          el.placeholder
      ).catch(() => '')) || ''
    ).toLowerCase();

    let answer = '';
    if (/country of residence|country/i.test(label)) answer = defaults.country || 'Nigeria';
    else if (/nationality|citizenship/i.test(label)) answer = defaults.nationality || 'Nigerian';
    else if (/city/i.test(label)) answer = defaults.city || 'Kaduna';
    else if (/state/i.test(label)) answer = defaults.state || 'Kaduna';
    else if (/hours per week/i.test(label)) answer = '0';
    else if (/working hours in est/i.test(label)) answer = '10:00 AM - 6:30 PM EST';
    else if (/what is the va id|va id/i.test(label)) answer = 'N/A';
    else if (/linkedin/i.test(label)) answer = defaults.linkedinProfileUrl || 'https://linkedin.com';
    else if (/reference.*name/i.test(label)) answer = 'Available upon request';
    else if (/reference.*email/i.test(label)) answer = 'references@example.com';
    else if (/reference.*phone/i.test(label)) answer = defaults.phone || '07062187105';
    else answer = 'Available';

    await reactFill(input, answer);
  }

  // 3. Dropdown selects
  const selects = await page.locator('select:visible').all().catch(() => []);
  for (const sel of selects) {
    const current = await sel.inputValue().catch(() => '');
    if (current && current !== '?' && current !== '') continue;
    const label = (
      (await sel.evaluate(
        (el) =>
          el.labels?.[0]?.innerText ||
          el.closest('label')?.innerText ||
          el.closest('.question, .section')?.innerText
      ).catch(() => '')) || ''
    ).toLowerCase();

    if (/country/i.test(label)) {
      await sel.selectOption({ label: 'Nigeria' }).catch(() => sel.selectOption({ index: 1 }));
    } else {
      await sel.selectOption({ index: 1 }).catch(() => {});
    }
  }

  // 4. Secondary file attachments (e.g. LOI / Cover letter file)
  if (ctx.resumePath) {
    const fileInputs = await page.locator('input[type="file"]:visible, .attachment input[type="file"]').all().catch(() => []);
    for (const f of fileInputs) {
      const filesCount = await f.evaluate((el) => el.files?.length).catch(() => 0);
      if (!filesCount) {
        await f.setInputFiles(ctx.resumePath).catch(() => {});
      }
    }
  }

  // 5. Consent and Privacy checkboxes
  const checkboxes = await page.locator('input[type="checkbox"]:visible').all().catch(() => []);
  for (const cb of checkboxes) {
    const checked = await cb.isChecked().catch(() => false);
    if (!checked) {
      await cb.check({ force: true }).catch(() => {});
    }
  }
}

async function advance(page, step, ctx) {
  // Multi-step questionnaire solving loop
  const maxSteps = 6;
  for (let s = 0; s < maxSteps; s++) {
    await answerQuestionnaireFields(page, ctx);
    await fillKnownRequiredFields(page, ctx);
    await page.waitForTimeout(1000);

    const submitBtn = page.locator('button:has-text("Submit Application"), button.bzyButtonColor:has-text("Submit")').first();
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button.bzyButtonColor:has-text("Continue")').first();

    if (await submitBtn.isVisible().catch(() => false)) {
      break;
    } else if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3000);
    } else {
      break;
    }
  }

  const audit = await auditRequiredFields(page);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `Breezy HR pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Breezy HR form filled and stopped before Submit Application.'
    };
  }

  const submit = page.locator('button:has-text("Submit Application"), button.bzyButtonColor:has-text("Submit"), button[type="submit"]').first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'Breezy HR Submit Application button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'Breezy HR Submit Application button is disabled; required fields may be missing.' };
  }

  await submit.click({ force: true }).catch(() => {});
  await page.waitForTimeout(6000);
  const submitted = await isSubmitted(page);
  return {
    step: submitted.submitted ? FormStep.SUBMITTED : FormStep.REVIEW,
    advanced: submitted.submitted,
    reason: submitted.reason || submitted.markers?.join(', ') || ''
  };
}

async function isSubmitted(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const markers = [];

  const headingMatch = body.match(/thank you for applying|application submitted|your application has been submitted|your application has been received|we have received your application/i);
  if (headingMatch) markers.push(headingMatch[0]);

  return {
    submitted: markers.length > 0,
    proof: markers.length > 0 ? Proof.TEXT_CONFIRMATION : Proof.NOT_SUBMITTED,
    markers,
    reason: markers.length > 0 ? 'Breezy HR submission confirmation detected.' : 'No Breezy HR confirmation message found.'
  };
}

async function verifySubmission(page, options = {}) {
  const sub = await isSubmitted(page);
  if (!sub.submitted) return noProof(sub.reason);

  let screenshotPath;
  if (options.saveScreenshot !== false) {
    const ts = Date.now();
    screenshotPath = `artifacts/breezyhr-confirmed-${ts}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {
      screenshotPath = undefined;
    });
  }

  return proofFound(Proof.TEXT_CONFIRMATION, {
    markers: sub.markers,
    screenshotPath,
    message: sub.reason
  });
}

async function uploadResume(page, resumePath) {
  if (!resumePath) return;
  const input = page.locator('input[name="cResume"], input[type="file"]').first();
  if (await input.count().catch(() => 0)) {
    await input.setInputFiles(resumePath).catch(() => {});
    await page.waitForTimeout(3000); // allow Breezy parser to process
  }
}

export const breezyHrAdapter = {
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
};

export default breezyHrAdapter;
