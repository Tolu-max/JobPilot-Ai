import { FormStep, Proof, noProof, proofFound } from './types.js';
import { reactFill, auditRequiredFields, checkAllRadioGroups, splitName, firstPhone } from './atsFormHelpers.js';

const NAME = 'smartrecruiters';
const CAREERS_URL = /(?:jobs|careers)\.smartrecruiters\.com|smartrecruiters\.com\/.+\/jobs\//i;
const SUBMITTED_TEXT = /thank you for (?:applying|your application)|application (?:received|submitted|complete)|your application has been (?:submitted|received)|we have received your application/i;
const SUBMITTED_URL = /\/(?:thank-you|thanks|confirmation|submitted)(?:\/|\?|$)/i;

function matches(url) {
  return CAREERS_URL.test(String(url || ''));
}

async function getCurrentStep(page) {
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  if (SUBMITTED_TEXT.test(body) || SUBMITTED_URL.test(url)) {
    return FormStep.SUBMITTED;
  }

  const firstNameInput = await page.locator('input[name="firstName"], #firstName, input[data-qa="first-name"]').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  const emailInput = await page.locator('input[name="email"], #email, input[data-qa="email"]').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  const fileInput = await page.locator('input[type="file"], #resume-upload').first()
    .isVisible({ timeout: 1000 }).catch(() => false);

  if (firstNameInput || emailInput || fileInput) {
    return FormStep.DETAILS;
  }

  if (/i'm interested|apply for this job|apply now/i.test(body)) {
    return FormStep.UNKNOWN;
  }

  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  // If we're on a job page with an "I'm interested" or "Apply" button and no form visible yet
  const applyBtn = page.locator('a:has-text("I\'m interested"), button:has-text("I\'m interested"), a[href*="/apply"], button:has-text("Apply")').first();
  if (await applyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await applyBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const fullName = candidate.name || defaults.fullName || '';
  const { first: firstName, last: lastName } = splitName(fullName);
  const email = ctx.config?.applicantEmail || candidate.email || defaults.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const coverLetter = ctx.coverLetter || defaults.coverLetter || candidate.bio || defaults.summary || '';
  const linkedin = candidate.linkedin || candidate.portfolioLinks?.linkedin || defaults.linkedinProfileUrl || '';
  const website = candidate.portfolio || candidate.website || defaults.portfolioUrl || '';

  await uploadResume(page, ctx.resumePath);

  // First & Last name or single Full name
  await reactFill(page, 'input[name="firstName"], #firstName, input[data-qa="first-name"]', firstName);
  await reactFill(page, 'input[name="lastName"], #lastName, input[data-qa="last-name"]', lastName);
  await reactFill(page, 'input[name="fullName"], #fullName, input[name="name"]', fullName);

  // Contact info
  await reactFill(page, 'input[name="email"], #email, input[data-qa="email"]', email);
  await reactFill(page, 'input[name="phoneNumber"], input[name="phone"], #phoneNumber, #phone, input[data-qa="phone-number"]', phone);

  // Social / Links
  if (linkedin) {
    await reactFill(page, 'input[name*="linkedin" i], input[id*="linkedin" i]', linkedin);
  }
  if (website) {
    await reactFill(page, 'input[name*="website" i], input[name*="portfolio" i], input[id*="website" i]', website);
  }

  // Cover letter / Message to Hiring Manager
  if (coverLetter) {
    await reactFill(page, 'textarea[name="messageToHiringManager"], textarea[name="message"], textarea[name="coverLetter"], textarea#message', coverLetter);
  }

  // Handle radio groups (e.g. EEO / Demographics)
  await checkAllRadioGroups(page);

  await page.waitForTimeout(500);
}

async function advance(page, step, ctx) {
  const audit = await auditRequiredFields(page);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `SmartRecruiters pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: SmartRecruiters form filled and stopped before Submit Application.'
    };
  }

  const submit = page.locator('button[type="submit"], button[data-qa="submit-application"], button:has-text("Submit Application"), button:has-text("Submit"), button:has-text("Next")').first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'SmartRecruiters Submit Application button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'SmartRecruiters Submit Application button is disabled; required fields may be missing.' };
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
  const url = page.url();
  const markers = [];

  const headingMatch = body.match(SUBMITTED_TEXT);
  if (headingMatch) markers.push(headingMatch[0]);
  if (SUBMITTED_URL.test(url)) markers.push(`URL: ${url}`);

  return {
    submitted: markers.length > 0,
    proof: markers.length > 0 ? Proof.TEXT_CONFIRMATION : Proof.NOT_SUBMITTED,
    markers,
    reason: markers.length > 0 ? 'SmartRecruiters submission confirmation detected.' : 'No SmartRecruiters confirmation message found.'
  };
}

async function verifySubmission(page, options = {}) {
  const sub = await isSubmitted(page);
  if (!sub.submitted) return noProof(sub.reason);

  let screenshotPath;
  if (options.saveScreenshot !== false) {
    const ts = Date.now();
    screenshotPath = `artifacts/smartrecruiters-confirmed-${ts}.png`;
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
  const input = page.locator('input[type="file"], input[name="resume"], #resume-upload').first();
  if (await input.count().catch(() => 0)) {
    await input.setInputFiles(resumePath).catch(() => {});
  }
}

export const smartRecruitersAdapter = {
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
};

export default smartRecruitersAdapter;
