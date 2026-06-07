import { FormStep, Proof, noProof } from './types.js';

const NAME = 'jobberman';

function matches(url) {
  return /jobberman\.com/i.test(String(url || ''));
}

const LOGIN_URL = 'https://www.jobberman.com/seeker/login';
const LOGIN_WALL = /login to apply|log ?in to (your )?account|sign in to apply|continue with google|continue with linkedin/i;
const SUBMITTED = /application (sent|submitted|received)|successfully applied|you have applied/i;

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function getCurrentStep(page, ctx = {}) {
  let body = await bodyText(page);

  // Jobberman requires an authenticated jobseeker session. If we hit the login
  // wall, log in with the profile's credentials (the persistent browser context
  // keeps the session for future runs) and return to the job before continuing.
  if (LOGIN_WALL.test(body)) {
    const login = await ensureJobbermanLogin(page, ctx);
    if (!login.ok) return FormStep.ERROR;
    const jobUrl = ctx?.job?.applicationUrl || ctx?.job?.jobUrl;
    if (jobUrl) await page.goto(jobUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);
    body = await bodyText(page);
  }

  if (SUBMITTED.test(body)) {
    return FormStep.SUBMITTED;
  }
  if (/apply for .+submit and apply|submit and apply|apply here/i.test(body)) {
    return FormStep.DETAILS;
  }
  return FormStep.UNKNOWN;
}

async function ensureJobbermanLogin(page, ctx = {}) {
  const email = ctx?.config?.jobbermanEmail;
  const password = ctx?.config?.jobbermanPassword;
  if (!email || !password) {
    return { ok: false, reason: 'No Jobberman credentials configured.' };
  }

  try {
    if (!/login|sign-?in/i.test(page.url())) {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    const emailInput = page
      .locator('input[type="email"], input[name="email"], #email, input[autocomplete="username"]')
      .first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(email);

    // Some flows reveal the password field only after the email is submitted.
    let passwordInput = page.locator('input[type="password"], input[name="password"], #password').first();
    if (!(await passwordInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await page.getByRole('button', { name: /continue|next|log ?in|sign ?in/i }).first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
      passwordInput = page.locator('input[type="password"], input[name="password"], #password').first();
    }
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await passwordInput.fill(password);

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
      page.getByRole('button', { name: /log ?in|sign ?in|continue|submit/i }).first().click({ force: true }).catch(() => {})
    ]);
    await page.waitForTimeout(2500);

    const after = await bodyText(page);
    if (/incorrect (email|password)|invalid (email|credentials|login)|wrong password/i.test(after)) {
      return { ok: false, reason: 'Jobberman rejected the credentials.' };
    }
    if (LOGIN_WALL.test(after) && /password/i.test(after)) {
      return { ok: false, reason: 'Jobberman login form still present after submit (extra verification or CAPTCHA).' };
    }
    return { ok: true, reason: 'Logged into Jobberman.' };
  } catch (error) {
    return { ok: false, reason: `Jobberman login error: ${error.message}` };
  }
}

async function fillStep(page, step, ctx) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (LOGIN_WALL.test(body)) {
    // getCurrentStep already attempted automated login; reaching here means it
    // failed (missing creds, bad creds, or a login CAPTCHA). Hand off to a human.
    throw manualReviewError('Jobberman automated login did not succeed; a logged-in jobseeker account is required to apply.');
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
