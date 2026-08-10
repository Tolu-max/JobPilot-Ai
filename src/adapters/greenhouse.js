import { FormStep, Proof, noProof, proofFound } from './types.js';

const NAME = 'greenhouse';

function matches(url) {
  return /(?:boards|job-boards)\.greenhouse\.io/i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/thank you for applying|thanks for applying|your application has been submitted|we have received your application|successfully submitted/i.test(body)) {
    return FormStep.SUBMITTED;
  }
  if (await page.locator('#first_name, #last_name, #email, #resume').first().isVisible({ timeout: 1000 }).catch(() => false)) {
    return FormStep.DETAILS;
  }
  if (/submit application|apply/i.test(body)) return FormStep.DETAILS;
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  if (step !== FormStep.DETAILS && step !== FormStep.UNKNOWN) return;

  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const name = candidate.name || defaults.fullName || '';
  const [firstName, ...lastParts] = name.trim().split(/\s+/).filter(Boolean);
  const lastName = lastParts.join(' ');
  const email = ctx.config?.applicantEmail || candidate.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const location = candidate.location || defaults.location || defaults.city || '';

  await upload(page, '#resume, input[type="file"][id*="resume" i], input[type="file"]', ctx.resumePath);
  await fillPersonalFields(page, { firstName, lastName, email, phone, country: defaults.country || 'Nigeria', location });
  await fillOptionalProfileFields(page, ctx);
  await fillQuestionInputs(page, ctx);
  await chooseComboboxes(page, ctx);
  await chooseRadioGroups(page);
  await chooseCheckboxGroups(page);
  await chooseSelects(page);
  await answerTextareas(page, ctx);
  await fillPersonalFields(page, { firstName, lastName, email, phone, country: defaults.country || 'Nigeria' });
  await page.waitForTimeout(500);
}

async function fillPersonalFields(page, { firstName, lastName, email, phone, country, location }) {
  await fill(page, '#first_name, input[aria-label="First Name"]', firstName, { overwrite: true });
  await fill(page, '#last_name, input[aria-label="Last Name"]', lastName, { overwrite: true });
  await fill(page, '#preferred_name, input[aria-label="Preferred First Name"]', firstName, { overwrite: true });
  await fill(page, '#email, input[aria-label="Email"]', email, { overwrite: true });
  await fill(page, '#phone, input[aria-label="Phone"]', phone, { overwrite: true });
  await fillAutocomplete(page, '#country', country, { overwrite: true });
  if (location) {
    await fillAutocomplete(page, '#candidate-location, input[aria-label*="Location" i], input[id*="location" i]', location, { overwrite: true });
  }
}

async function advance(page, step, ctx) {
  const eligibility = await inspectTruthfulEligibility(page, ctx);
  if (!eligibility.ok) {
    return {
      step,
      advanced: false,
      reason: eligibility.reason,
      meta: eligibility
    };
  }

  const audit = await getGreenhouseAuditState(page, ctx);
  if (!audit.ok) {
    return {
      step,
      advanced: false,
      reason: `Greenhouse pre-submit audit blocked submit: ${audit.reason}`,
      meta: audit
    };
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Greenhouse form filled and stopped before Submit application.'
    };
  }

  const submit = page.locator('#submit_app, button[type="submit"]:has-text("Submit application"), button:has-text("Submit application")').first();
  if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'Greenhouse Submit application button was not visible.' };
  }
  if (await submit.isDisabled().catch(() => false)) {
    return { step, advanced: false, reason: 'Greenhouse Submit application button is disabled; required fields may be missing.' };
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

async function isSubmitted(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const url = page.url();
  const markers = [];
  if (/thank you for applying|thanks for applying|your application has been submitted|we have received your application|successfully submitted/i.test(body)) {
    markers.push('Greenhouse confirmation text detected');
  }
  if (/confirmation|submitted|thank/i.test(url)) {
    markers.push(`Greenhouse confirmation-like URL: ${url}`);
  }
  return markers.length ? proofFound(markers) : noProof('No Greenhouse confirmation detected.');
}

async function verifySubmission() {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Greenhouse has no safe generic independent re-verification configured yet.'
  };
}

async function fill(page, selector, value, options = {}) {
  if (!value) return false;
  const locators = page.locator(selector);
  const count = await locators.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const loc = locators.nth(index);
    if (!(await loc.isVisible({ timeout: 1000 }).catch(() => false))) continue;
    if (await loc.isDisabled().catch(() => false)) continue;

    const current = await loc.inputValue().catch(() => '');
    if (current.trim() && !options.overwrite) return true;

    await forceFillControlledInput(loc, value);
    const after = await loc.inputValue().catch(() => '');
    if (after.trim()) return true;
  }
  return false;
}

async function upload(page, selector, resumePath) {
  if (!resumePath) return;
  const inputs = page.locator(selector);
  const count = await inputs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    try {
      await inputs.nth(index).setInputFiles(resumePath, { timeout: 8000 });
      await page.waitForTimeout(1200);
      return;
    } catch {
      // Try the next file input.
    }
  }
}

async function fillOptionalProfileFields(page, ctx) {
  const defaults = ctx.config?.applicationDefaults || {};
  await fill(page, 'input[aria-label*="LinkedIn" i], input[id*="linkedin" i]', defaults.linkedinProfileUrl || '');
  await fill(page, 'input[aria-label*="Website" i], input[id*="website" i]', defaults.portfolioUrl || defaults.linkedinProfileUrl || '');
}

async function fillQuestionInputs(page, ctx) {
  const inputs = page.locator('input[id^="question_"][type="text"]:not([role="combobox"]):visible, input[id^="question_"]:not([type]):not([role="combobox"]):visible');
  const count = await inputs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const current = await input.inputValue().catch(() => '');
    if (current.trim()) continue;

    const prompt = await fieldPrompt(input);
    const promptText = String(prompt || '').toLowerCase();
    if (/zip ?code|zipcode/.test(promptText) && /nigeria/i.test(String(ctx.config?.applicationDefaults?.country || ''))) continue;
    let answer = answerForPrompt(prompt, ctx);
    if (!answer) {
      if (/linkedin/i.test(promptText)) answer = ctx.config?.applicationDefaults?.linkedinProfileUrl || ctx.candidate?.linkedin || '';
      else if (/website|portfolio|github/i.test(promptText)) answer = ctx.candidate?.website || ctx.candidate?.github || ctx.candidate?.portfolio || '';
      else if (/salary|compensation|expected pay/i.test(promptText)) answer = ctx.config?.applicationDefaults?.desiredSalary || 'Negotiable';
      else if (/referr|referred|how did you hear|source/i.test(promptText)) answer = 'LinkedIn';
      else if (/name.*team member|who referred/i.test(promptText)) answer = 'N/A';
      else if (/company.*partner|agency|customer\.io|worked for/i.test(promptText)) answer = 'No';
      else if (/company.*worked|how many companies|employer count/i.test(promptText)) answer = '3';
    }
    if (answer) await forceFillControlledInput(input, answer.slice(0, 500)).catch(() => {});
  }
}

async function chooseRadioGroups(page) {
  const radios = await page.locator('input[type="radio"]:visible').all();
  const seen = new Set();
  for (const radio of radios) {
    const name = await radio.getAttribute('name').catch(() => '') || await radio.getAttribute('id').catch(() => '');
    if (seen.has(name)) continue;
    seen.add(name);
    const checked = await page.locator(`input[type="radio"][name="${cssAttr(name)}"]:checked`).count().catch(() => 0);
    if (checked > 0) continue;
    await radio.check({ force: true }).catch(() => {});
  }
}

async function chooseComboboxes(page, ctx) {
  const boxes = await page.locator('input[role="combobox"]:visible').all();
  for (const box of boxes) {
    const current = await box.inputValue().catch(() => '');
    if (current.trim()) continue;

    const prompt = await fieldPrompt(box);
    const choice = choiceForPrompt(prompt, ctx);
    if (!choice) continue;

    await box.scrollIntoViewIfNeeded().catch(() => {});
    await box.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);

    // Try to find an option matching the desired choice.
    let options = await page.locator('[role="option"]:visible').allInnerTexts().catch(() => []);
    if (!options.length) {
      // Open the dropdown with Arrow Down if options didn't render.
      await box.press('ArrowDown').catch(() => {});
      await page.waitForTimeout(400);
      options = await page.locator('[role="option"]:visible').allInnerTexts().catch(() => []);
    }

    let targetIndex = options.findIndex((text) => new RegExp(escapeRegExp(String(choice)), 'i').test(text));
    if (targetIndex === -1 && /yes|no/i.test(choice)) {
      targetIndex = options.findIndex((text) => /^\s*(yes|no)\s*$/i.test(text));
    }
    if (targetIndex === -1 && /how many years|years of experience|quantity|number of/i.test(prompt)) {
      // Pick a middle "1-2 years" or "2+ years" option if available.
      targetIndex = options.findIndex((text) => /(1[-–]2|2\+|1\+|2[-–]3|0[-–]1)/i.test(text));
    }
    if (targetIndex === -1) {
      // Fallback: pick the first non-empty option that is not a placeholder.
      targetIndex = options.findIndex((text) => text.trim() && !/select|choose|option/i.test(text));
    }

    if (targetIndex >= 0) {
      const option = page.locator('[role="option"]:visible').nth(targetIndex);
      await option.click({ force: true }).catch(() => {});
    } else {
      await box.pressSequentially(String(choice), { delay: 20 }).catch(() => {});
      await page.waitForTimeout(400);
      await box.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(300);
  }
}

function choiceForPrompt(prompt, ctx) {
  const text = String(prompt || '').toLowerCase();
  if (/authorized|legally authorized|legal.*work/.test(text)) return truthfulWorkAuthorizationAnswer(text, ctx);
  if (/sponsorship|sponsor/.test(text)) return 'No';
  if (/privacy|ai policy|understood|agree|confirm.*read|consent|acknowledge/.test(text)) return 'Yes';
  if (/2 years|two years|experience|csat|customer support|saas|tech|remote|work from home|fully remote/.test(text)) return 'Yes';
  if (/country/.test(text)) return ctx.config?.applicationDefaults?.country || 'Nigeria';
  if (/location|city|where.*based|work from|plan.*work/.test(text)) return ctx.config?.applicationDefaults?.city || ctx.config?.applicationDefaults?.location || 'Lagos';
  if (/how many years|years of experience|quantity|number of/.test(text)) return '1-2';
  if (/gender|sex|identity|nationality|race|ethnicity|disability|veteran|lgbtq|demographic|pronoun|marital/.test(text)) return 'Prefer not to say';
  if (/degree|education|university|college|qualification|result|grading|mathematics|native language|high school/.test(text)) {
    return 'Bachelor\'s degree';
  }
  if (/referr|referred|how did you hear|source|found this job|where did you learn/.test(text)) return 'LinkedIn';
  if (/current.*work|previously employed|past 2 years|partner agency|customer\.io/.test(text)) return 'No';
  return 'Yes';
}

export async function getGreenhouseAuditState(page, ctx = {}) {
  return page.locator('body').evaluate((defaults) => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const promptFor = (element) => {
      const id = element.getAttribute('id');
      const label = id && window.CSS?.escape ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const container = element.closest('label, fieldset, .field, .application-question, div');
      return [label?.textContent, element.getAttribute('aria-label'), element.getAttribute('placeholder'), container?.textContent]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    };

    const requiredInputs = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((element) => visible(element))
      .filter((element) => {
        const ignored = element.getAttribute('aria-hidden') === 'true' || element.tabIndex === -1;
        const role = element.getAttribute('role');
        return !ignored && role !== 'combobox' && (element.required || element.getAttribute('aria-required') === 'true');
      });

    const missingRequired = requiredInputs
      .filter((element) => {
        const prompt = promptFor(element).toLowerCase();
        if (/if you are based in the u\.s\..*(zip ?code|zipcode)/i.test(prompt)) return false;
        if (element.type === 'checkbox' || element.type === 'radio') {
          const name = element.getAttribute('name');
          if (!name) return !element.checked;
          return !document.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
        }
        if (element.type === 'file') return !element.files?.length;
        return !String(element.value || '').trim();
      })
      .map((element) => ({
        id: element.id || '',
        name: element.getAttribute('name') || '',
        type: element.type || element.tagName.toLowerCase(),
        prompt: promptFor(element)
      }));

    const invalidFields = Array.from(document.querySelectorAll('[aria-invalid="true"], input:invalid, textarea:invalid, select:invalid'))
      .filter((element) => visible(element))
      .filter((element) => {
        const prompt = promptFor(element).toLowerCase();
        if (/if you are based in the u\.s\..*(zip ?code|zipcode)/i.test(prompt)) return false;
        if (element.getAttribute('role') !== 'combobox') return true;
        const selected = element.parentElement?.parentElement?.querySelector('.select__single-value')?.textContent || '';
        return !String(selected).trim();
      })
      .map((element) => ({
        id: element.id || '',
        name: element.getAttribute('name') || '',
        type: element.type || element.tagName.toLowerCase(),
        prompt: promptFor(element)
      }));

    const visibleErrors = Array.from(document.querySelectorAll('.error, [class*="error" i], [class*="invalid" i], [role="alert"]'))
      .filter((element) => visible(element))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 10);

    const unresolvedComboboxes = Array.from(document.querySelectorAll('input[role="combobox"]'))
      .filter((element) => visible(element))
      .filter((element) => {
        const required = element.required || element.getAttribute('aria-required') === 'true';
        const prompt = promptFor(element).toLowerCase();
        const likelyRequired = required || /country|authorized|sponsor|privacy|experience|years|support|saas|tech/.test(prompt);
        const selected = element.parentElement?.parentElement?.querySelector('.select__single-value')?.textContent || '';
        return likelyRequired && !String(element.value || '').trim() && !String(selected).trim();
      })
      .map((element) => ({
        id: element.id || '',
        name: element.getAttribute('name') || '',
        prompt: promptFor(element)
      }));

    const issues = [];
    if (missingRequired.length) issues.push(`${missingRequired.length} required field(s) missing`);
    if (invalidFields.length) issues.push(`${invalidFields.length} invalid field(s)`);
    if (unresolvedComboboxes.length) issues.push(`${unresolvedComboboxes.length} unresolved combobox(es)`);
    if (visibleErrors.length && (missingRequired.length || invalidFields.length || unresolvedComboboxes.length)) {
      issues.push(`${visibleErrors.length} visible error message(s)`);
    }

    return {
      ok: issues.length === 0,
      reason: issues.join('; ') || 'Greenhouse form passed required-field audit.',
      missingRequired,
      invalidFields,
      unresolvedComboboxes,
      visibleErrors
    };
  }, ctx.config?.applicationDefaults || {}).catch((error) => ({
    ok: false,
    reason: `Greenhouse audit failed: ${error.message}`,
    missingRequired: [],
    invalidFields: [],
    unresolvedComboboxes: [],
    visibleErrors: []
  }));
}

async function chooseCheckboxGroups(page) {
  const checkboxes = await page.locator('input[type="checkbox"]:visible').all();
  const seen = new Set();
  for (const checkbox of checkboxes) {
    const name = await checkbox.getAttribute('name').catch(() => '') || await checkbox.getAttribute('id').catch(() => '');
    if (seen.has(name)) continue;
    seen.add(name);
    const prompt = await fieldPrompt(checkbox);
    if (isLocationOrEligibilityPrompt(prompt)) continue;
    const checked = name
      ? await page.locator(`input[type="checkbox"][name="${cssAttr(name)}"]:checked`).count().catch(() => 0)
      : 0;
    if (checked > 0) continue;
    await checkbox.check({ force: true }).catch(() => {});
  }
}

async function chooseSelects(page) {
  const selects = await page.locator('select:visible').all();
  for (const select of selects) {
    const current = await select.inputValue().catch(() => '');
    if (current) continue;
    const prompt = await fieldPrompt(select);
    if (isLocationOrEligibilityPrompt(prompt)) continue;
    const options = await select.evaluate((el) => Array.from(el.options).map((option) => option.value).filter(Boolean)).catch(() => []);
    if (options.length) await select.selectOption(options[0]).catch(() => {});
  }
}

async function answerTextareas(page, ctx) {
  const textareas = page.locator('textarea:visible');
  const count = await textareas.count().catch(() => 0);
  const fallback = ctx.coverLetter || ctx.candidate?.summary || ctx.config?.candidateProfile?.summary || '';
  for (let index = 0; index < count; index += 1) {
    const textarea = textareas.nth(index);
    const current = await textarea.inputValue().catch(() => '');
    if (current.trim()) continue;
    const prompt = await fieldPrompt(textarea);
    let answer = answerForPrompt(prompt, ctx);
    if (!answer && fallback) answer = fallback;
    if (answer) await textarea.fill(answer.slice(0, 1500));
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

function answerForPrompt(prompt, ctx) {
  const answers = ctx.answers || {};
  const normalized = String(prompt || '').toLowerCase();
  if (/why|fit|qualified|hire/.test(normalized)) return answers.why_good_fit || answers.general || ctx.coverLetter || '';
  if (/experience|background|describe|tell us/.test(normalized)) return answers.describe_experience || answers.general || '';
  if (/salary|compensation/.test(normalized)) return ctx.config?.applicationDefaults?.desiredSalary || 'Negotiable';
  if (/country/.test(normalized)) return ctx.config?.applicationDefaults?.country || 'Nigeria';
  if (/skill|tool|software|platform/.test(normalized)) return answers.relevant_skills || answers.general || '';
  if (/remote|communication|timezone/.test(normalized)) return answers.remote_work || answers.general || '';
  return answers.general || ctx.coverLetter || '';
}

async function inspectTruthfulEligibility(page, ctx) {
  return page.locator('body').evaluate((defaults) => {
    const text = document.body.innerText || '';
    const country = String(defaults?.country || '').toLowerCase();
    const candidateIsNigeria = country.includes('nigeria');
    const blockers = [];

    if (candidateIsNigeria && /\b(authorized|legally authorized|eligible).{0,60}(united states|u\.s\.|us\b|canada|canadian)\b/i.test(text)) {
      blockers.push('Form asks for US/Canada work authorization; candidate country is Nigeria.');
    }
    if (candidateIsNigeria && /\b(select|choose).{0,80}(canadian province|province you'll be working from|us state|u\.s\. state)\b/i.test(text)) {
      blockers.push('Form requires a US/Canada work location selection; candidate country is Nigeria.');
    }
    if (candidateIsNigeria && /\b(must|required).{0,80}(live|reside|located|based).{0,80}(united states|u\.s\.|us\b|canada|canadian)\b/i.test(text)) {
      blockers.push('Posting requires US/Canada residency or location.');
    }

    return {
      ok: blockers.length === 0,
      reason: blockers.join(' ') || 'No truthful eligibility blocker detected.',
      blockers
    };
  }, ctx.config?.applicationDefaults || {}).catch((error) => ({
    ok: false,
    reason: `Eligibility audit failed: ${error.message}`,
    blockers: [error.message]
  }));
}

function truthfulWorkAuthorizationAnswer(prompt, ctx) {
  const country = String(ctx.config?.applicationDefaults?.country || '').toLowerCase();
  if (country.includes('nigeria') && /\b(united states|u\.s\.|us\b|canada|canadian)\b/i.test(prompt)) return 'No';
  return 'Yes';
}

function isLocationOrEligibilityPrompt(prompt) {
  return /canadian province|province you'll be working from|us state|u\.s\. state|authorized|legally authorized|eligible.*work|work authorization|sponsorship|visa/i.test(String(prompt || ''));
}

async function fillAutocomplete(page, selector, value, options = {}) {
  if (!value) return false;
  const inputs = page.locator(selector);
  const count = await inputs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) continue;
    if (await input.isDisabled().catch(() => false)) continue;
    const current = await input.inputValue().catch(() => '');
    if (current.trim() && !options.overwrite) return true;

    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ force: true }).catch(() => {});
    await clearInput(input);
    await input.pressSequentially(String(value), { delay: 20 }).catch(() => {});
    await page.waitForTimeout(500);
    const visibleOptions = page.locator('[role="option"]:visible');
    const option = visibleOptions.filter({ hasText: new RegExp(`^\\s*${escapeRegExp(String(value))}\\s*$`, 'i') }).first();
    if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
      await option.click({ force: true }).catch(() => {});
    } else if (await visibleOptions.count().catch(() => 0)) {
      await visibleOptions.first().click({ force: true }).catch(() => {});
    } else {
      await page.keyboard.press('ArrowDown').catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
    }

    await page.waitForTimeout(400);
    const after = await input.inputValue().catch(() => '');
    if (after.trim() && new RegExp(escapeRegExp(String(value)), 'i').test(after)) return true;
    if (after.trim()) return true;
  }
  return false;
}

async function forceFillControlledInput(locator, value) {
  const text = String(value || '');
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true }).catch(() => {});
  await clearInput(locator);
  await locator.evaluate((el, nextValue) => {
    const prototype = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    descriptor?.set?.call(el, nextValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, text).catch(async () => {
    await locator.fill('').catch(() => {});
    await locator.pressSequentially(text, { delay: 20 }).catch(async () => {
      await locator.fill(text).catch(() => {});
    });
  });
  const afterNativeSet = await locator.inputValue().catch(() => '');
  if (!afterNativeSet.trim()) {
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await locator.pressSequentially(text, { delay: 20 }).catch(() => {});
  }
  await locator.evaluate((el) => el.blur()).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function clearInput(locator) {
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await locator.press('Backspace').catch(() => {});
  await locator.evaluate((el) => {
    const prototype = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssAttr(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function firstPhone(phone) {
  return String(phone || '').split(',')[0].trim();
}

export const greenhouseAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default greenhouseAdapter;
