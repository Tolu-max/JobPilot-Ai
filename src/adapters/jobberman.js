import { FormStep, Proof, noProof } from './types.js';

const NAME = 'jobberman';

function matches(url) {
  return /jobberman\.com/i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/login to apply|log in|sign up|continue with google|continue with linkedin/i.test(body)) {
    return FormStep.ERROR;
  }
  if (/application (sent|submitted|received)|successfully applied|you have applied/i.test(body)) {
    return FormStep.SUBMITTED;
  }
  if (/apply for .+submit and apply|submit and apply|apply here/i.test(body)) {
    return FormStep.DETAILS;
  }
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/login to apply|log in|sign up|continue with google|continue with linkedin/i.test(body)) {
    throw manualReviewError('Jobberman requires a logged-in jobseeker account before the application form is available.');
  }

  const applyButton = page.getByRole('button', { name: /apply here/i }).first();
  if (await applyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await applyButton.click({ force: true });
    await page.waitForTimeout(1500);
  }

  const salary = jobbermanSalaryExpectation(ctx);
  const salaryInput = page.locator('input[name="salary_expectation"], #salary_expectation').first();
  if (await salaryInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    if (!salary) {
      throw manualReviewError('Jobberman requires a monthly salary expectation before applying.');
    }
    await salaryInput.fill(String(salary));
  }

  const uploadedCv = page.locator('select[name="uploaded_cv"]').first();
  if (await uploadedCv.isVisible({ timeout: 3000 }).catch(() => false)) {
    const current = await uploadedCv.inputValue().catch(() => '');
    if (!current) {
      const options = await uploadedCv.evaluate((el) => Array.from(el.options).map((option) => option.value).filter(Boolean)).catch(() => []);
      if (options[0]) await uploadedCv.selectOption(options[0]).catch(() => {});
    }
  }

  const coverLetter = page.locator('textarea[name="description"], #cover_letter_display').first();
  if (await coverLetter.isVisible({ timeout: 3000 }).catch(() => false)) {
    const current = await coverLetter.inputValue().catch(() => '');
    if (!current) {
      await coverLetter.fill(ctx.coverLetter || ctx.answers?.general || defaultCoverLetter(ctx));
    }
  }
}

async function advance(page, step, ctx) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Jobberman form filled and stopped before Submit and apply.'
    };
  }

  const submit = page.getByRole('button', { name: /submit and apply/i }).last();
  if (await submit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submit.click({ force: true });
    await page.waitForTimeout(5000);
    const submitted = await isSubmitted(page);
    return {
      step: submitted.submitted ? FormStep.SUBMITTED : FormStep.REVIEW,
      advanced: submitted.submitted,
      reason: submitted.reason || submitted.markers?.join(', ') || ''
    };
  }

  return {
    step,
    advanced: false,
    reason: 'Jobberman Submit and apply button was not visible.'
  };
}

async function isSubmitted(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/application (sent|submitted|received)|successfully applied|you have applied/i.test(body)) {
    return {
      submitted: true,
      markers: ['Jobberman confirmation text detected'],
      reason: ''
    };
  }
  return noProof('No Jobberman submission confirmation detected.');
}

async function verifySubmission(ctx) {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Jobberman has no unauthenticated submission verification flow configured.'
  };
}

function manualReviewError(message) {
  const error = new Error(message);
  error.manualReview = true;
  return error;
}

function jobbermanSalaryExpectation(ctx) {
  const defaults = ctx.config?.applicationDefaults || ctx.config?.preferences?.applicationDefaults || {};
  return defaults.jobbermanSalaryExpectationNgn ||
    ctx.config?.preferences?.jobbermanSalaryExpectationNgn ||
    ctx.answers?.jobberman_salary_expectation_ngn ||
    ctx.answers?.salary_expectation_ngn ||
    salaryExpectationFromJob(ctx.job);
}

function salaryExpectationFromJob(job = {}) {
  const salaryText = String(job.salary || job.compensation || '');
  const numbers = [...salaryText.matchAll(/\d[\d,]*/g)]
    .map((match) => Number.parseInt(match[0].replace(/,/g, ''), 10))
    .filter(Number.isFinite)
    .filter((value) => value > 0);
  if (numbers.length >= 2) {
    return roundToNearest(Math.round((Math.min(...numbers) + Math.max(...numbers)) / 2), 10000);
  }
  if (numbers.length === 1) return numbers[0];
  return '';
}

function roundToNearest(value, nearest) {
  return Math.round(value / nearest) * nearest;
}

function defaultCoverLetter(ctx) {
  const candidate = ctx.candidate || {};
  const skills = Array.isArray(candidate.skills) ? candidate.skills.slice(0, 8).join(', ') : '';
  return `I am interested in this role because it matches my experience in customer support, administration, CRM tools, and clear communication. I am organized, reliable, available for full-time remote work, and confident I can support customers with patience and accuracy.${skills ? ` My relevant skills include ${skills}.` : ''}`;
}

export const jobbermanAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default jobbermanAdapter;
