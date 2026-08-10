import { FormStep, Proof, noProof } from './types.js';

const NAME = 'jobberman';

function matches(url) {
  return /jobberman\.com/i.test(String(url || ''));
}

const HOME_URL = 'https://www.jobberman.com';
const LOGIN_URL = 'https://www.jobberman.com/account/login';
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
  // The public Jobberman header can show a Login link even on an authenticated
  // listing/application page. Only treat it as an auth wall when the page
  // explicitly asks the candidate to log in or the browser is on the login URL.
  if (LOGIN_WALL.test(body) || /\/account\/login|\/account\/sign-?in/i.test(page.url())) {
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

  const applicationFormVisible = await hasApplicationFormFields(page);
  if (applicationFormVisible || /submit and apply/i.test(body)) {
    return FormStep.DETAILS;
  }

  // Job detail page — "Apply here" button or easy-apply button present but form not yet open.
  // fillStep will click it to reveal the full form.
  const applyBtnVisible = typeof page.getByRole === 'function'
    ? await page
      .getByRole('button', { name: /apply here|easy apply|apply now|apply for/i })
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false)
    : false;
  if (applyBtnVisible) return FormStep.DETAILS;

  // Also catch the case where we're on a Jobberman job URL and not on login/error page.
  const onJobUrl = /jobberman\.com\/(jobs|listing|vacancy|apply)/i.test(page.url()) && applicationFormVisible;
  if (onJobUrl) return FormStep.DETAILS;

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
      const clickedLogin = await clickLoginFromJobbermanHome(page);
      if (!clickedLogin) {
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
    await page.waitForTimeout(1500);
    await acceptJobbermanCookies(page);
    await page.waitForTimeout(1000);
    await acceptJobbermanCookies(page);

    const emailInput = page
      .locator('input[type="email"], input[name="username"], input[name="email"], #username, #email, input[autocomplete="username"], input[autocomplete="email"]')
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
    await page.waitForTimeout(15000);

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
      passwordInput.press('Enter').catch(() => {})
    ]);
    await page.waitForTimeout(2500);

    const after = await bodyText(page);
    if (/page expired|419 error/i.test(after)) {
      return { ok: false, reason: 'Jobberman login expired with a 419 CSRF/session error.' };
    }
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

  if (!await hasApplicationFormFields(page)) {
    await openJobbermanApplyPanel(page);
  }

  if (!await hasApplicationFormFields(page)) {
    throw manualReviewError('Jobberman application form did not open after clicking Apply here.');
  }
  await acceptJobbermanCookies(page);

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

async function clickLoginFromJobbermanHome(page) {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await acceptJobbermanCookies(page);
  const loginLink = page
    .locator('[data-cy="login-button-navbar"], a[href*="/account/login"]')
    .first();
  if (!await loginLink.isVisible({ timeout: 3000 }).catch(() => false)) return false;
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
    loginLink.click({ force: true }).catch(() => {})
  ]);
  return /login|sign-?in/i.test(page.url());
}

async function acceptJobbermanCookies(page) {
  const accept = page
    .getByRole('button', { name: /accept all cookies|accept all/i })
    .first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function hasApplicationFormFields(page) {
  const submitVisible = await page
    .getByRole('button', { name: /submit and apply/i })
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (submitVisible) return true;

  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    return Array.from(document.querySelectorAll('input, textarea, select')).some((el) => {
      if (!visible(el) || el.disabled) return false;
      const key = [
        el.getAttribute('name'),
        el.getAttribute('id'),
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label')
      ].filter(Boolean).join(' ');
      return /salary_expectation|uploaded_cv|cover_letter|description/i.test(key);
    });
  }).catch(() => false);
}

async function openJobbermanApplyPanel(page) {
  const waitForForm = async () => {
    await page
      .getByRole('button', { name: /submit and apply/i })
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    return hasApplicationFormFields(page);
  };

  if (await waitForForm()) return true;

  const applyButtons = page.locator('button[aria-label="Apply here"], button[title="Apply here"]');
  const count = typeof applyButtons.count === 'function'
    ? await applyButtons.count().catch(() => 0)
    : 0;
  for (let index = count - 1; index >= 0; index -= 1) {
    const button = applyButtons.nth(index);
    if (!await button.isVisible({ timeout: 1000 }).catch(() => false)) continue;
    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    await forceOpenJobbermanApplyForm(page);
    if (await waitForForm()) return true;
    await clickApplyAnywayIfVisible(page);
    await forceOpenJobbermanApplyForm(page);
    if (await waitForForm()) return true;
  }

  // Jobberman renders the application form server-side and hides it with an
  // Alpine store flag. Some bot-safe/headless sessions do not fire the x-on
  // click consistently, so set the same store flag the button would set.
  await forceOpenJobbermanApplyForm(page);
  await page.waitForTimeout(1000);
  await clickApplyAnywayIfVisible(page);
  await forceOpenJobbermanApplyForm(page);
  return waitForForm();
}

async function forceOpenJobbermanApplyForm(page) {
  await page.evaluate(() => {
    const globalStore = window.Alpine?.store?.('global');
    if (globalStore) {
      globalStore.mobileApplyFormOpen = true;
      globalStore.modal = '';
    }
  }).catch(() => {});
  await page.waitForTimeout(500);
}

async function clickApplyAnywayIfVisible(page) {
  const applyAnyway = page
    .getByRole('button', { name: /apply anyway/i })
    .first();
  if (await applyAnyway.isVisible({ timeout: 1000 }).catch(() => false)) {
    await applyAnyway.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
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

  await acceptJobbermanCookies(page);
  const submit = await visibleButton(page, /submit and apply/i);
  if (submit) {
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    await submit.click({ force: true });
    await page.waitForTimeout(1500);
    await clickApplyAnywayIfVisible(page);
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

async function visibleButton(page, namePattern) {
  const buttons = page.getByRole('button', { name: namePattern });
  const count = await buttons.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) return button;
  }
  return null;
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
