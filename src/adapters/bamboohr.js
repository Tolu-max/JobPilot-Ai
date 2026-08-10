import { FormStep, Proof, noProof, proofFound } from './types.js';
import { reactFill, auditRequiredFields, splitName, firstPhone } from './atsFormHelpers.js';

const NAME = 'bamboohr';
const CAREERS_URL = /\.bamboohr\.com\/careers(?:\/\d+)?\/?$/i;
const SUBMITTED_TEXT = /thank you for applying|application submitted|your application has been submitted|we have received your application|thanks for applying/i;

function matches(url) {
  return CAREERS_URL.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (SUBMITTED_TEXT.test(body)) return FormStep.SUBMITTED;

  const fileInput = await page.locator('input[type="file"][aria-label="file-input"], input[type="file"]').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  const firstName = await page.locator('input[name="firstName"], #firstName').first()
    .isVisible({ timeout: 1000 }).catch(() => false);

  if (fileInput || firstName || /submit application/i.test(body)) return FormStep.DETAILS;
  if (/apply for this job/i.test(body)) return FormStep.UNKNOWN;
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const { first, last } = splitName(candidate.name || defaults.fullName || '');
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const country = defaults.country || 'Nigeria';
  const address = defaults.address || candidate.address || 'Remote';
  const city = defaults.city || candidate.city || 'Lagos';
  const state = defaults.state || candidate.state || 'Outside US';
  const zip = defaults.zip || candidate.zip || '000000';
  const desiredPay = defaults.desiredSalary || defaults.desiredPay || 'Negotiable';
  const portfolio = defaults.portfolioUrl || defaults.websiteUrl || candidate.portfolio || candidate.website || '';
  const linkedin = defaults.linkedinProfileUrl || candidate.linkedin || '';

  await openApplicationForm(page);
  await uploadResume(page, ctx.resumePath);

  await reactFill(page, 'input[name="firstName"], #firstName', first);
  await reactFill(page, 'input[name="lastName"], #lastName', last);
  await reactFill(page, 'input[name="email"], #email', email);
  await reactFill(page, 'input[name="phone"], #phone', phone);
  await reactFill(page, 'input[name="streetAddress.value"]', address);
  await reactFill(page, 'input[name="city.value"]', city);
  await fillSelect(page, 'select[name="state.value"]', state);
  await reactFill(page, 'input[name="zip.value"]', zip);
  await fillSelect(page, 'select[name="countryId.value"]', country);
  await reactFill(page, 'input[name="desiredPay"], #desiredPay', desiredPay);
  await reactFill(page, 'input[name="websiteUrl"], #websiteUrl', portfolio);
  await reactFill(page, 'input[name="linkedinUrl"], #linkedinUrl', linkedin);
  await answerTextareas(page, ctx);
  await page.waitForTimeout(500);
}

async function advance(page, step, ctx) {
  const audit = await auditRequiredFields(page);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `BambooHR pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: BambooHR form filled and stopped before Submit Application.'
    };
  }

  const submit = page.getByRole('button', { name: /submit application/i }).first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'BambooHR Submit Application button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'BambooHR Submit Application button is disabled; required fields may be missing.' };
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
  if (SUBMITTED_TEXT.test(body)) markers.push('BambooHR confirmation text detected');
  return markers.length ? proofFound(markers) : noProof('No BambooHR confirmation detected.');
}

async function verifySubmission() {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'BambooHR has no safe generic independent re-verification configured yet.'
  };
}

async function openApplicationForm(page) {
  const firstNameVisible = await page.locator('input[name="firstName"], #firstName').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  if (firstNameVisible) return;

  const applyButton = page.getByRole('button', { name: /apply for this job/i }).first();
  if (await applyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await applyButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
  }
}

async function uploadResume(page, resumePath) {
  if (!resumePath) return;
  const input = page.locator('input[type="file"][aria-label="file-input"], input[type="file"]').first();
  if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) return;
  await input.setInputFiles(resumePath, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function fillSelect(page, selector, desired) {
  if (!desired) return false;
  const select = page.locator(selector).first();
  if (!(await select.isVisible({ timeout: 2000 }).catch(() => false))) return false;

  const options = await select.evaluate((el) =>
    Array.from(el.options).map((option) => ({
      value: option.value,
      label: (option.textContent || '').trim()
    }))
  ).catch(() => []);

  if (!options.length) return false;
  const wanted = String(desired).toLowerCase();
  const match = options.find((option) => option.label.toLowerCase() === wanted)
    || options.find((option) => option.label.toLowerCase().includes(wanted))
    || options.find((option) => option.value && !/^select$/i.test(option.value))
    || options.find((option) => option.value);

  if (!match?.value) return false;
  await select.selectOption(match.value).catch(() => {});
  await page.waitForTimeout(200);
  return true;
}

async function answerTextareas(page, ctx) {
  const answers = ctx.answers || {};
  const coverLetter = ctx.coverLetter || '';
  const textareas = page.locator('textarea:visible');
  const count = await textareas.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const textarea = textareas.nth(index);
    const name = await textarea.getAttribute('name').catch(() => '');
    if (/g-recaptcha-response/i.test(name || '')) continue;
    const current = await textarea.inputValue().catch(() => '');
    if (current.trim()) continue;

    const prompt = await fieldPrompt(textarea);
    const answer = answerForPrompt(prompt, answers, coverLetter);
    if (!answer) continue;
    await reactFill(page, textarea, answer.slice(0, 1500));
  }
}

async function fieldPrompt(locator) {
  return locator.evaluate((el) => {
    const id = el.getAttribute('id');
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const container = el.closest('div, fieldset, label');
    return [label?.textContent, el.getAttribute('aria-label'), el.getAttribute('placeholder'), container?.textContent]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }).catch(() => '');
}

function answerForPrompt(prompt, answers, coverLetter) {
  const text = String(prompt || '').toLowerCase();
  if (/why.*good fit|good fit|qualified|hire/i.test(text)) {
    return answers.why_good_fit || answers.general || coverLetter;
  }
  if (/experience|background|describe|tell us/i.test(text)) {
    return answers.describe_experience || answers.general || coverLetter;
  }
  if (/skill|tool|software|platform|linkedin|website/i.test(text)) {
    return answers.relevant_skills || answers.general || coverLetter;
  }
  return answers.general || coverLetter || '';
}

export const bamboohrAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default bamboohrAdapter;
