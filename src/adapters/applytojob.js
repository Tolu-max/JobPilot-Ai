import { FormStep, Proof, noProof, proofFound } from './types.js';

const NAME = 'applytojob';

function matches(url) {
  return /applytojob\.com\/apply/i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/thank you|application (received|submitted)|we have received|successfully submitted/i.test(body)) {
    return FormStep.SUBMITTED;
  }
  if (/apply for this position|submit application|human check/i.test(body)) {
    return FormStep.DETAILS;
  }
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const nameParts = splitName(candidate.name || defaults.fullName || '');

  await fill(page, '#resumator-firstname-value', nameParts.first || 'Temiloluwa');
  await fill(page, '#resumator-lastname-value', nameParts.last || 'Ruth Oyelola');
  await fill(page, '#resumator-email-value', email);
  await fill(page, '#resumator-phone-value', firstPhone(candidate.phone || defaults.phone || ''));

  await fill(page, '#resumator-address-value', defaults.address || 'Kaduna, Nigeria');
  await fill(page, '#resumator-city-value', defaults.city || 'Kaduna');
  await fill(page, '#resumator-state-value', defaults.state || 'Kaduna');
  await fill(page, '#resumator-postal-value', defaults.postalCode || '800001');

  await uploadResume(page, ctx.resumePath);
  await fill(page, '#resumator-linkedin-value', defaults.linkedinProfileUrl || ctx.config?.linkedinProfileUrl || 'N/A');
  await fill(page, '#resumator-languages-value', defaults.languages || 'English');
  await fill(page, '#resumator-salary-value', defaults.desiredSalary || desiredSalary(ctx.job));
}

async function advance(page, step, ctx) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: ApplyToJob form filled and stopped before Submit Application.'
    };
  }

  const submit = page.locator('#resumator-submit-resume').first();
  if (await submit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submit.click({ force: true });
    await page.waitForTimeout(6000);
    const submitted = await isSubmitted(page);
    return {
      step: submitted.submitted ? FormStep.SUBMITTED : FormStep.REVIEW,
      advanced: submitted.submitted,
      reason: submitted.reason || submitted.markers?.join(', ') || ''
    };
  }

  return { step, advanced: false, reason: 'ApplyToJob Submit Application button was not visible.' };
}

async function isSubmitted(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/thank you|application (received|submitted)|we have received|successfully submitted|your application has been/i.test(body)) {
    return proofFound(['ApplyToJob confirmation text detected']);
  }
  return noProof('No ApplyToJob submission confirmation detected.');
}

async function verifySubmission(ctx) {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'ApplyToJob has no independent submission verification configured.'
  };
}

async function fill(page, selector, value) {
  if (!value) return;
  const locator = page.locator(selector).first();
  if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
    await locator.fill(String(value));
  }
}

async function uploadResume(page, resumePath) {
  if (!resumePath) return;

  const chooseUpload = page.locator('#resumator-choose-upload').first();
  if (await chooseUpload.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chooseUpload.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const input = page.locator('#resumator-resume-value, input[type="file"]').first();
  if (await input.count().catch(() => 0)) {
    await input.setInputFiles(resumePath).catch(() => {});
    await page.waitForTimeout(1500);
  }
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.slice(1).join(' ') || ''
  };
}

function firstPhone(phone) {
  return String(phone || '').split(',')[0].trim();
}

function desiredSalary(job = {}) {
  const salary = String(job.salary || '').trim();
  if (salary) return salary;
  return 'Negotiable';
}

export const applyToJobAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default applyToJobAdapter;
