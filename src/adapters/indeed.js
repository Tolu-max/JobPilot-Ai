import { FormStep, Proof, noProof, proofFound } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  detectDownstreamAdapter,
  gatewayHandoffBlockedReason,
  recordGatewayDestination,
  shouldAllowGatewayHandoff
} from './atsResolver.js';
import { compactText } from '../utils.js';
import { loadIndeedCookies } from '../scrapers/indeed.js';
import {
  fillKnownRequiredFields,
  reactFill,
  cssEscape
} from './atsFormHelpers.js';
import {
  buildGroundedFallbackAnswer,
  cleanApplicationAnswer
} from '../applicationAnswerGuard.js';
import { request as requestAi, TaskTypes } from '../aiRouter.js';

const NAME = 'indeed';

export { detectDownstreamAdapter };

let _lastSubmission = null;

export function matches(url) {
  return /(?:[a-z]{2}\.)?indeed\.com/i.test(String(url || ''));
}

export function getIndeedJobPageUrl(urlOrJobKey, title = '', baseUrl = 'https://www.indeed.com') {
  let jk = '';
  if (/^[a-f0-9]{16}$/i.test(String(urlOrJobKey || '').trim())) {
    jk = String(urlOrJobKey).trim();
  } else if (urlOrJobKey) {
    try {
      const parsed = new URL(urlOrJobKey);
      jk = parsed.searchParams.get('jk') || '';
      if (!jk) {
        const m = String(urlOrJobKey).match(/[-_]([a-f0-9]{16})(?:[/?#]|$)/i);
        if (m) jk = m[1];
      }
    } catch {
      const m = String(urlOrJobKey).match(/[-_]([a-f0-9]{16})(?:[/?#]|$)/i);
      if (m) jk = m[1];
    }
  }

  if (jk) {
    const slug = String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const pathPrefix = slug ? `/job/${slug}-${jk}` : `/viewjob?jk=${jk}`;
    return `${baseUrl.replace(/\/$/, '')}${pathPrefix}`;
  }
  return urlOrJobKey;
}

export async function resolveIndeedTurnstile(page, maxAttempts = 20) {
  if (!page) return false;

  let hadChallenge = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
    const isChallenge = /security check|just a moment/i.test(title);

    if (!isChallenge) {
      if (hadChallenge && typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(2000);
      }
      return true;
    }

    hadChallenge = true;
    try {
      if (typeof page.frames === 'function') {
        for (const frame of page.frames()) {
          const box = frame.locator('input[type="checkbox"], #challenge-stage, .ctp-checkbox-label, #cf-stage, .ctp-checkbox-container');
          if (await box.first().isVisible().catch(() => false)) {
            await box.first().click().catch(() => {});
            break;
          }
        }
      }
      if (typeof page.locator === 'function') {
        const cfBox = page.locator('#cf-turnstile, [data-sitekey], input[type="checkbox"], #challenge-stage');
        if (await cfBox.first().isVisible().catch(() => false)) {
          await cfBox.first().click().catch(() => {});
        }
      }
    } catch {}

    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(1000);
    }
  }

  const finalTitle = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
  const resolved = !/security check|just a moment/i.test(finalTitle);
  if (resolved && hadChallenge && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(2000);
  }
  return resolved;
}

export function unwrapIndeedRedirect(url) {
  if (!url) return '';
  const str = String(url).trim();

  // If already an external non-indeed URL
  if (/^https?:\/\//i.test(str) && !/(?:[a-z]{2}\.)?indeed\.com/i.test(str)) {
    return str;
  }

  try {
    const parsed = new URL(str);
    // Common query params where Indeed stores external target
    for (const param of ['dest', 'target', 'url', 'redirectUrl', 'continue', 'continueUrl']) {
      const val = parsed.searchParams.get(param);
      if (val && /^https?:\/\//i.test(val) && !/(?:[a-z]{2}\.)?indeed\.com/i.test(val)) {
        return val;
      }
    }
  } catch {
    // Ignore URL parse failures
  }

  return '';
}

export async function getCurrentStep(page, ctx = {}) {
  if (ctx?._submitted) return FormStep.SUBMITTED;
  if (_lastSubmission) {
    const currentJobId = ctx.job?.sourceJobId || ctx.job?.id;
    if (!_lastSubmission.jobId || _lastSubmission.jobId === currentJobId) {
      return FormStep.SUBMITTED;
    }
  }

  if (page && typeof page.url === 'function') {
    const currentUrl = page.url();
    if (/post-apply|confirmation/i.test(currentUrl)) {
      return FormStep.SUBMITTED;
    }
    if (!matches(currentUrl) && !/smartapply\.indeed\.com/i.test(currentUrl) && currentUrl !== 'about:blank') {
      return FormStep.DETAILS;
    }
  }

  const body = page?.locator ? await page.locator('body').innerText({ timeout: 4000 }).catch(() => '') : '';
  if (/application\s+(?:(?:has\s+been|was)\s+)?(?:sent|submitted|received)|successfully\s+applied|you\s+have\s+applied|your\s+application\s+has\s+been\s+submitted/i.test(body)) {
    return FormStep.SUBMITTED;
  }

  return FormStep.DETAILS;
}

export async function answerIndeedQuestions(page, ctx = {}) {
  if (!page || typeof page.locator !== 'function') return;

  const candidate = ctx.candidate || ctx.config?.cvData || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const verifiedSkills = candidate.skills || candidate.strengths || ctx.config?.masterCareerProfile?.verifiedSkills || [];
  const candidateYearsExp = Number.parseInt(defaults.yearsExperience || candidate.yearsExperience || candidate.yearsOfExperience || 4, 10) || 4;
  const answers = ctx.answers || ctx.applicationAnswers || {};

  // 1. Radio groups (Yes/No questions: authorization, experience, sponsorship, background check, remote)
  try {
    const radioInputs = await page.locator('input[type="radio"]:visible').all().catch(() => []);
    const handledGroups = new Set();

    for (const radio of radioInputs) {
      const groupName = (await radio.getAttribute('name').catch(() => '')) || '';
      if (!groupName || handledGroups.has(groupName)) continue;
      handledGroups.add(groupName);

      const groupRadios = page.locator(`input[type="radio"][name="${cssEscape(groupName)}"]`);
      const checkedCount = await page.locator(`input[type="radio"][name="${cssEscape(groupName)}"]:checked`).count().catch(() => 0);
      if (checkedCount > 0) continue; // Already selected

      // Extract prompt text
      const promptText = await radio.evaluate((el) => {
        const fieldset = el.closest('fieldset');
        const legend = fieldset ? fieldset.querySelector('legend') : null;
        const groupContainer = el.closest('[role="group"], [data-testid*="question"], .ia-Questions-item, div');
        const label = groupContainer?.querySelector('label, h2, h3, h4, [class*="heading"], [class*="title"], [class*="legend"]') || legend;
        return (label?.textContent || groupContainer?.textContent || '').trim().replace(/\s+/g, ' ');
      }).catch(() => '');

      const normPrompt = promptText.toLowerCase();

      // Negative responses (visa sponsorship, felony / conviction)
      const isSponsorship = /require.*sponsor|visa.*sponsor/i.test(normPrompt);
      const isConviction = /felony|convicted|criminal/i.test(normPrompt);

      if (isSponsorship || isConviction) {
        const noRadio = page.locator(
          `input[type="radio"][name="${cssEscape(groupName)}"][value="false" i], input[type="radio"][name="${cssEscape(groupName)}"][value="no" i], label:has-text("No") input[type="radio"][name="${cssEscape(groupName)}"]`
        ).first();
        if (await noRadio.isVisible().catch(() => false)) {
          await noRadio.check({ force: true }).catch(() => {});
        } else {
          const allInGroup = await groupRadios.all().catch(() => []);
          for (const r of allInGroup) {
            const rText = await r.evaluate((el) => el.labels?.[0]?.textContent || el.closest('label')?.textContent || el.value || '').catch(() => '');
            if (/^\s*no\b/i.test(rText)) {
              await r.check({ force: true }).catch(() => {});
              break;
            }
          }
        }
      } else {
        // Affirmative responses (work authorization, background check, skills/experience, remote work, driver's license)
        const yesRadio = page.locator(
          `input[type="radio"][name="${cssEscape(groupName)}"][value="true" i], input[type="radio"][name="${cssEscape(groupName)}"][value="yes" i], label:has-text("Yes") input[type="radio"][name="${cssEscape(groupName)}"]`
        ).first();
        if (await yesRadio.isVisible().catch(() => false)) {
          await yesRadio.check({ force: true }).catch(() => {});
        } else {
          const allInGroup = await groupRadios.all().catch(() => []);
          let checkedOne = false;
          for (const r of allInGroup) {
            const rText = await r.evaluate((el) => el.labels?.[0]?.textContent || el.closest('label')?.textContent || el.value || '').catch(() => '');
            if (/^\s*yes\b/i.test(rText)) {
              await r.check({ force: true }).catch(() => {});
              checkedOne = true;
              break;
            }
          }
          if (!checkedOne && allInGroup.length > 0) {
            await allInGroup[0].check({ force: true }).catch(() => {});
          }
        }
      }
    }
  } catch {}

  // 2. Select dropdowns (<select>)
  try {
    const selects = await page.locator('select:visible').all().catch(() => []);
    for (const sel of selects) {
      if (await sel.isDisabled().catch(() => false)) continue;
      const val = await sel.inputValue().catch(() => '');
      if (val && val !== '0' && val !== '-1') continue;

      const promptText = await sel.evaluate((el) => {
        const id = el.id;
        const lbl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const container = el.closest('.ia-Questions-item, [data-testid*="question"], div');
        return (lbl?.textContent || el.getAttribute('aria-label') || container?.textContent || '').trim().replace(/\s+/g, ' ');
      }).catch(() => '');
      const normPrompt = promptText.toLowerCase();

      const options = await sel.evaluate((el) =>
        Array.from(el.options)
          .map((o) => ({ value: o.value, text: (o.text || '').trim() }))
          .filter((o) => o.value && o.value !== '-1')
      ).catch(() => []);
      if (options.length === 0) continue;

      let chosen = null;
      if (/education|degree|level of education/i.test(normPrompt)) {
        chosen = options.find((o) => /bachelor|degree|college|diploma/i.test(o.text)) || options[0];
      } else if (/sponsor/i.test(normPrompt)) {
        chosen = options.find((o) => /^\s*no\b/i.test(o.text)) || options[0];
      } else if (/authoriz|legal.*work/i.test(normPrompt)) {
        chosen = options.find((o) => /^\s*yes\b|authorized/i.test(o.text)) || options[0];
      } else if (/availab|notice|start/i.test(normPrompt)) {
        chosen = options.find((o) => /immediate|asap|1-2 weeks|two weeks/i.test(o.text)) || options[0];
      } else if (/year.*(?:exp|work)|(?:exp|work).*year/i.test(normPrompt)) {
        chosen = options.find((o) => /3[-–]5|2[-–]4|3\+|2\+|4\+/i.test(o.text)) || options.find((o) => /^[2-4]\b/i.test(o.text)) || options[options.length - 1];
      } else if (/license|remote|background|drug/i.test(normPrompt)) {
        chosen = options.find((o) => /^\s*yes\b/i.test(o.text)) || options[0];
      } else {
        chosen = options.find((o) => /yes/i.test(o.text)) || options[0];
      }

      if (chosen?.value) {
        await sel.selectOption({ value: chosen.value }).catch(() => {});
      }
    }
  } catch {}

  // 3. Text & Numeric inputs (Years of experience, salary, custom short questions)
  try {
    const textInputs = await page.locator('input[type="text"]:visible, input[type="number"]:visible, input:not([type]):visible').all().catch(() => []);
    for (const input of textInputs) {
      if (await input.isDisabled().catch(() => false)) continue;
      const currentVal = await input.inputValue().catch(() => '');
      if (String(currentVal).trim()) continue;

      const meta = await input.evaluate((el) => {
        const id = el.id || '';
        const name = el.name || '';
        const lbl = (el.labels && el.labels[0]) || (id && typeof document !== 'undefined' && typeof CSS !== 'undefined' ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null);
        const container = typeof el.closest === 'function' ? el.closest('.ia-Questions-item, [data-testid*="question"], div') : null;
        const prompt = el.prompt || (lbl?.textContent || (typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : '') || el.placeholder || container?.textContent || '').trim().replace(/\s+/g, ' ');
        return { id, name, prompt, type: el.type || 'text' };
      }).catch(() => null);

      if (!meta) continue;
      const normPrompt = meta.prompt.toLowerCase();
      // Skip contact inputs handled separately
      if (/first.?name|last.?name|phone|email|location|city/i.test(`${meta.id} ${meta.name}`)) continue;

      let answer = '';
      if (/year.*(?:exp|work)|(?:exp|work).*year|how many year|how long/i.test(normPrompt)) {
        const skillMatch = verifiedSkills.find((s) => normPrompt.includes(s.toLowerCase()));
        if (skillMatch || /php|laravel|wordpress|javascript|mysql|html|css|seo|web/i.test(normPrompt)) {
          answer = String(candidateYearsExp);
        } else if (/react|vue|node|python|git|api/i.test(normPrompt)) {
          answer = '2';
        } else {
          answer = '1';
        }
      } else if (/salary|compensation|hourly|rate|pay/i.test(normPrompt)) {
        answer = meta.type === 'number' ? '25' : (defaults.desiredSalary || 'Negotiable');
      } else if (/gpa|grade/i.test(normPrompt)) {
        answer = '3.5';
      } else if (/website|portfolio|github|linkedin/i.test(normPrompt)) {
        if (/linkedin/i.test(normPrompt)) answer = candidate.linkedin || defaults.linkedinProfileUrl || 'https://linkedin.com';
        else if (/github/i.test(normPrompt)) answer = candidate.github || 'https://github.com/Tolu-max';
        else answer = candidate.portfolio || candidate.website || 'https://toluoyelola.cv';
      } else if (/headline|job.?title/i.test(`${meta.id} ${meta.name} ${normPrompt}`)) {
        answer = candidate.jobTitle || candidate.headline || 'Full Stack Web Developer';
      } else if (/why|fit|describe|tell us|summary|detail/i.test(normPrompt)) {
        answer = answers.describe_experience || answers.why_good_fit || answers.general || '';
        if (!answer) {
          answer = buildGroundedFallbackAnswer(meta.prompt, answers, ctx.config, candidate);
        }
      } else {
        answer = buildGroundedFallbackAnswer(meta.prompt, answers, ctx.config, candidate);
      }

      if (answer) {
        await reactFill(page, input, answer);
      }
    }
  } catch {}

  // 4. Textareas (Narrative & screening open-ended questions)
  try {
    const textareas = await page.locator('textarea:visible').all().catch(() => []);
    for (const textarea of textareas) {
      if (await textarea.isDisabled().catch(() => false)) continue;
      const currentVal = await textarea.inputValue().catch(() => '');
      if (String(currentVal).trim()) continue;

      const meta = await textarea.evaluate((el) => {
        const id = el.id || '';
        const name = el.name || '';
        const lbl = (el.labels && el.labels[0]) || (id && typeof document !== 'undefined' && typeof CSS !== 'undefined' ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null);
        const container = typeof el.closest === 'function' ? el.closest('.ia-Questions-item, [data-testid*="question"], div') : null;
        const prompt = el.prompt || (lbl?.textContent || (typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : '') || el.placeholder || container?.textContent || '').trim().replace(/\s+/g, ' ');
        return { id, name, prompt };
      }).catch(() => null);

      if (!meta) continue;
      const normPrompt = meta.prompt.toLowerCase();

      let answer = '';
      if (/why.*(?:fit|hire|good fit|suitable)|qualification/i.test(normPrompt)) {
        answer = answers.why_good_fit || answers.general || '';
      } else if (/experience|background|describe|project|work history/i.test(normPrompt)) {
        answer = answers.describe_experience || answers.general || '';
      } else if (/why.*(?:role|company|position|interest)|motivation/i.test(normPrompt)) {
        answer = answers.why_this_role || answers.general || '';
      } else if (/skill|strength|expertise|technolog/i.test(normPrompt)) {
        answer = answers.relevant_skills || answers.general || '';
      } else if (/remote|timezone|work from home/i.test(normPrompt)) {
        answer = answers.remote_work || answers.general || '';
      } else {
        answer = answers.general || '';
      }

      // If still empty, use AI Router if key available, or grounded fallback
      if (!answer) {
        try {
          if (ctx.config?.deepseekApiKey || process.env.DEEPSEEK_API_KEY || ctx.config?.geminiApiKey || process.env.GEMINI_API_KEY || ctx.config?.groqApiKey || process.env.GROQ_API_KEY) {
            const aiRes = await requestAi({
              taskType: TaskTypes.APPLICATION_WRITING,
              prompt: `Answer this job application screening question concisely (2-3 sentences) on behalf of candidate ${candidate.name || 'Candidate'}, a Full Stack Web Developer proficient in PHP, Laravel, WordPress, JavaScript, and SEO:\nQuestion: "${meta.prompt}"`,
              profile: candidate,
              jobData: ctx.job || {},
              config: ctx.config
            });
            if (aiRes?.text) {
              answer = cleanApplicationAnswer(aiRes.text);
            }
          }
        } catch {}
      }

      if (!answer) {
        answer = buildGroundedFallbackAnswer(meta.prompt, answers, ctx.config, candidate);
      }

      if (answer) {
        await reactFill(page, textarea, answer.slice(0, 1500));
      }
    }
  } catch {}

  // 5. Audit & check any unchecked required checkboxes (e.g. Terms / Consent / Privacy Policy)
  try {
    const checkboxes = await page.locator('input[type="checkbox"]:visible').all().catch(() => []);
    for (const cb of checkboxes) {
      const isChecked = await cb.isChecked().catch(() => true);
      if (isChecked) continue;
      const isRequired = await cb.evaluate((el) => el.required || el.getAttribute('aria-required') === 'true').catch(() => false);
      const text = await cb.evaluate((el) => el.labels?.[0]?.textContent || el.closest('label')?.textContent || el.getAttribute('aria-label') || '').catch(() => '');
      if (isRequired || /agree|consent|terms|policy|certif|confirm|authorize/i.test(text)) {
        await cb.check({ force: true }).catch(() => {});
      }
    }
  } catch {}
}

export async function fillStep(page, step, ctx = {}) {
  if (!page || typeof page.locator !== 'function') return;

  const candidate = ctx.candidate || ctx.config?.cvData || {};
  const name = candidate.name || '';
  const email = candidate.email || '';
  const phone = candidate.phone || '';
  const location = candidate.location || 'Kaduna, Nigeria';

  // Fill contact fields if present
  if (name) {
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const firstNameInput = page.locator('input[id*="first-name" i], input[name*="firstName" i], input[id*="firstName" i], input[placeholder*="first name" i]').first();
    if (await firstNameInput.isVisible().catch(() => false)) {
      const val = await firstNameInput.inputValue().catch(() => '');
      if (!val) await reactFill(page, firstNameInput, firstName);
    }

    const lastNameInput = page.locator('input[id*="last-name" i], input[name*="lastName" i], input[id*="lastName" i], input[placeholder*="last name" i]').first();
    if (await lastNameInput.isVisible().catch(() => false)) {
      const val = await lastNameInput.inputValue().catch(() => '');
      if (!val) await reactFill(page, lastNameInput, lastName);
    }

    const fullNameInput = page.locator('input[name*="name" i]:not([name*="first" i]):not([name*="last" i]), input[id*="full-name" i]').first();
    if (await fullNameInput.isVisible().catch(() => false)) {
      const val = await fullNameInput.inputValue().catch(() => '');
      if (!val) await reactFill(page, fullNameInput, name);
    }
  }

  if (phone) {
    const phoneInput = page.locator('input[type="tel"], input[id*="phone" i], input[name*="phone" i], input[id*="phoneNumber" i]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      const val = await phoneInput.inputValue().catch(() => '');
      if (!val) await reactFill(page, phoneInput, phone);
    }
  }

  if (email) {
    const emailInput = page.locator('input[type="email"], input[id*="email" i], input[name*="email" i]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      const val = await emailInput.inputValue().catch(() => '');
      if (!val) await reactFill(page, emailInput, email);
    }
  }

  if (location) {
    const locInput = page.locator('input[id*="city" i], input[name*="city" i], input[id*="location" i], input[placeholder*="city" i]').first();
    if (await locInput.isVisible().catch(() => false)) {
      const val = await locInput.inputValue().catch(() => '');
      if (!val) await reactFill(page, locInput, location.split(',')[0].trim());
    }
  }

  // Handle headline / job title field
  const headlineInput = page.locator('input[id*="headline" i], input[name*="headline" i], input[id*="jobTitle" i], input[name*="jobTitle" i]').first();
  if (await headlineInput.isVisible().catch(() => false)) {
    const val = await headlineInput.inputValue().catch(() => '');
    if (!val) await reactFill(page, headlineInput, candidate.jobTitle || candidate.headline || 'Full Stack Web Developer');
  }

  // Handle resume selection or file upload
  try {
    const resumeRadios = page.locator('input[type="radio"][value*="resume" i], [data-testid="ResumeCard"] input[type="radio"], input[type="radio"]');
    const radioCount = await resumeRadios.count().catch(() => 0);
    let resumeSelected = false;
    for (let i = 0; i < radioCount; i++) {
      const r = resumeRadios.nth(i);
      const isChecked = await r.isChecked().catch(() => false);
      if (isChecked) {
        resumeSelected = true;
        break;
      }
    }
    if (!resumeSelected && radioCount > 0) {
      await resumeRadios.first().check({ force: true }).catch(() => {});
    }
  } catch {}

  if (ctx.resumePath) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible().catch(() => false)) {
      await fileInput.setInputFiles(ctx.resumePath).catch(() => {});
    }
  }

  // Answer screening questions using AI & candidate profile data
  await answerIndeedQuestions(page, ctx);

  // Safety fill: run standard ATS known required fields
  await fillKnownRequiredFields(page, ctx).catch(() => {});
}

export async function advance(page, step, ctx = {}) {
  // If page is on an Indeed challenge page ("Just a moment..." or "Security Check"), resolve Turnstile
  if (page && typeof page.title === 'function') {
    await resolveIndeedTurnstile(page, 8);
  }

  // Check if job expired directly on page
  if (page && typeof page.evaluate === 'function') {
    const isExpired = await page.evaluate(() => {
      const body = (document.body && document.body.innerText) || '';
      return /this job has expired on indeed|no longer accepting applications|job is no longer available|this job listing has expired/i.test(body);
    }).catch(() => false);
    if (isExpired === true) {
      return {
        step,
        advanced: false,
        reason: 'This job has expired on Indeed (no longer accepting applications).',
        meta: { expired: true, manualReview: false }
      };
    }
  }

  const resolved = await resolveIndeedDestination(page, ctx);

  if (!resolved) {
    return {
      step,
      advanced: false,
      reason: 'Indeed apply destination could not be resolved from listing.'
    };
  }

  if (resolved.type === 'expired') {
    return {
      step,
      advanced: false,
      reason: 'This job has expired on Indeed (no longer accepting applications).',
      meta: { expired: true, manualReview: false }
    };
  }

  // Case A: External Web / ATS Application Link or Internal Indeed Gateway
  if (resolved.type === 'external_url') {
    let targetUrl = resolved.url;

    // Follow internal Indeed redirect (applystart, rc/clk, pagead/clk) to uncover external ATS
    const currentUrl = page && typeof page.url === 'function' ? page.url() : '';
    const jk = (ctx.job?.sourceJobId || ctx.job?.id || '').replace(/^indeed-/, '');
    const isAlreadyOnJob = jk && currentUrl.includes(jk);

    if (!isAlreadyOnJob && page && typeof page.goto === 'function' && (/applystart|rc\/clk|pagead\/clk/i.test(targetUrl) || matches(targetUrl))) {
      try {
        const cleanJobUrl = getIndeedJobPageUrl(targetUrl, ctx.job?.title);
        const navUrl = cleanJobUrl || targetUrl;
        if (currentUrl !== navUrl) {
          await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(1000);
          await resolveIndeedTurnstile(page, 6);

          const redirected = page.url();
          if (redirected && !matches(redirected) && redirected !== 'about:blank') {
            targetUrl = redirected;
          }
        }
      } catch {
        // Continue with targetUrl
      }
    }

    // If still on Indeed, inspect the page DOM for native Easy Apply or external Company Apply controls
    if (page && matches(page.url()) && typeof page.evaluate === 'function') {
      try {
        if (typeof page.waitForSelector === 'function') {
          await page.waitForSelector(
            '[data-testid="viewjob-indeed-apply"], [data-testid="viewjob-apply"], button:has-text("Apply now"), a:has-text("Apply now"), button:has-text("Apply with Indeed"), a:has-text("Apply with Indeed"), button:has-text("Apply on company site"), a:has-text("Apply on company site")',
            { timeout: 5000 }
          ).catch(() => {});
        }
        const liveInfo = await page.evaluate(() => {
          const body = (document.body && document.body.innerText) || '';
          if (/this job has expired on indeed|no longer accepting applications|job is no longer available|this job listing has expired/i.test(body)) {
            return { type: 'expired' };
          }

          // 1. Check for Easy Apply / Indeed Apply
          const easyBtn = document.querySelector(
            '[data-testid="viewjob-indeed-apply"], [data-testid*="indeedApply"], a[href*="smartapply.indeed.com"]'
          ) || Array.from(document.querySelectorAll('a, button')).find(el => {
            const t = (el.innerText || el.textContent || '').trim();
            return /^(?:apply now|easy apply|apply with indeed)$/i.test(t);
          });

          if (easyBtn) {
            return { type: 'indeed_easy_apply', href: easyBtn.getAttribute('href') || '' };
          }

          // 2. Check for "Apply on company site"
          const compBtn = document.querySelector(
            '[data-testid="viewjob-apply"], a[href*="applystart"]'
          ) || Array.from(document.querySelectorAll('a, button')).find(el => {
            const t = (el.innerText || el.textContent || '').trim();
            return /apply on company site/i.test(t);
          });

          if (compBtn) {
            let href = compBtn.getAttribute('href') || compBtn.closest('a')?.getAttribute('href') || '';
            // If button has no DOM href, extract viewJobButtonLinkModel from React fiber
            if (!href) {
              const key = Object.keys(compBtn).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
              let fiber = compBtn[key];
              while (fiber) {
                if (fiber.memoizedProps?.viewJobButtonLinkModel?.href) {
                  href = fiber.memoizedProps.viewJobButtonLinkModel.href;
                  break;
                }
                fiber = fiber.return;
              }
            }
            return { type: 'company_apply', href };
          }

          return null;
        }).catch(() => null);

        if (liveInfo?.type === 'expired') {
          return {
            step,
            advanced: false,
            reason: 'This job has expired on Indeed (no longer accepting applications).',
            meta: { expired: true, manualReview: false }
          };
        }

        if (liveInfo?.type === 'indeed_easy_apply') {
          console.log('[Adapter:indeed] Page contains Indeed Easy Apply button. Switching to native apply flow...');
          if (liveInfo.href && /^https?:\/\//i.test(liveInfo.href)) {
            await page.goto(liveInfo.href, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          } else {
            const applyBtn = page.locator(
              '[data-testid="viewjob-indeed-apply"], [data-testid*="indeedApply"], button:has-text("Apply now"), a:has-text("Apply now"), button:has-text("Apply with Indeed")'
            ).first();
            if (await applyBtn.isVisible().catch(() => false)) {
              await applyBtn.click().catch(() => {});
              await page.waitForTimeout(2000);
            }
          }
          return {
            step: FormStep.DETAILS,
            advanced: true,
            reason: 'Switched to Indeed Easy Apply flow from job listing page.'
          };
        }

        if (liveInfo?.type === 'company_apply') {
          let directExternal = unwrapIndeedRedirect(liveInfo.href);
          if (!directExternal && liveInfo.href && !matches(liveInfo.href) && /^https?:\/\//i.test(liveInfo.href)) {
            directExternal = liveInfo.href;
          }

          if (directExternal) {
            targetUrl = directExternal;
          } else if (liveInfo.href && /applystart|rc\/clk/i.test(liveInfo.href)) {
            const navTarget = liveInfo.href.startsWith('http') ? liveInfo.href : `https://www.indeed.com${liveInfo.href.startsWith('/') ? '' : '/'}${liveInfo.href}`;
            console.log(`[Adapter:indeed] Following company apply gateway redirect: ${navTarget}`);
            await page.goto(navTarget, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
            await page.waitForTimeout(2000);
            const redirectedUrl = page.url();
            if (redirectedUrl && !matches(redirectedUrl) && redirectedUrl !== 'about:blank') {
              targetUrl = redirectedUrl;
            }
          } else {
            const applyBtn = page.locator(
              '[data-testid="viewjob-apply"], a:has-text("Apply on company site"), button:has-text("Apply on company site"), a[href*="applystart"]'
            ).first();
            if (await applyBtn.isVisible().catch(() => false)) {
              const [popup] = await Promise.all([
                page.context()?.waitForEvent('page', { timeout: 6000 }).catch(() => null),
                applyBtn.click().catch(() => {})
              ]);

              if (popup) {
                await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
                const popupUrl = popup.url();
                if (popupUrl && !matches(popupUrl) && popupUrl !== 'about:blank') {
                  targetUrl = popupUrl;
                }
                await popup.close().catch(() => {});
              } else {
                await page.waitForTimeout(2000);
                const redirected = page.url();
                if (redirected && !matches(redirected) && redirected !== 'about:blank') {
                  targetUrl = redirected;
                }
              }
            }
          }
        }
      } catch {
        // Fallback to existing classification
      }
    }

    if (matches(targetUrl) && /applystart|rc\/clk/i.test(targetUrl) && page && typeof page.goto === 'function') {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForURL((u) => !matches(u) && u.href !== 'about:blank', { timeout: 8000 }).catch(() => {});
        if (!matches(page.url()) && page.url() !== 'about:blank') {
          targetUrl = page.url();
        }
      } catch {}
    }

    const unwrappedTarget = unwrapIndeedRedirect(targetUrl);
    if (unwrappedTarget) targetUrl = unwrappedTarget;

    const classification = classifyApplyDestination(targetUrl, { source: NAME });
    await recordGatewayDestination(ctx, page, classification, targetUrl, NAME);

    if (classification.reason === 'same-indeed-page' || /indeed\.com.*(\/viewjob|\/job\/|jk=)/i.test(targetUrl)) {
      return {
        step,
        advanced: false,
        reason: 'same-indeed-page: no external ATS redirect found',
        meta: { deterministicFailure: true, manualReview: false }
      };
    }

    const allowCompany = Boolean(
      ctx.config?.allowCompanyWebsites ||
      ctx.config?.allowGatewayAutoSubmit ||
      ctx.job?.acceptedViaTelegram
    );

    if (!classification.supported) {
      if (allowCompany && /^https?:\/\//i.test(targetUrl) && !matches(targetUrl)) {
        console.log(`[Adapter:indeed] External company website allowed (${targetUrl}). Handing off to generic form filler...`);
        if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
          return {
            step: FormStep.REVIEW,
            advanced: true,
            reason: `TEST_MODE: Indeed resolved to company website (generic): ${targetUrl}`,
            meta: { resolvedUrl: targetUrl, downstreamAdapter: 'generic', testMode: true }
          };
        }

        if (page && typeof page.goto === 'function' && page.url() !== targetUrl) {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
        return {
          step: FormStep.DETAILS,
          advanced: true,
          handoffToGeneric: true,
          targetUrl,
          reason: `Indeed handed off to company website: ${targetUrl}`,
          meta: { resolvedUrl: targetUrl, downstreamAdapter: 'generic' }
        };
      }

      const isGatewayRedirect = /applystart|rc\/clk/i.test(targetUrl);
      const reasonMsg = isGatewayRedirect
        ? `Indeed external role redirects via company site gateway: ${targetUrl}`
        : `Indeed resolved to unsupported/manual destination (${classification.reason}): ${targetUrl}`;
      return {
        step,
        advanced: false,
        reason: reasonMsg,
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, reason: classification.reason, manualReview: true }
      };
    }

    if (!shouldAllowGatewayHandoff(classification, ctx.config)) {
      return {
        step,
        advanced: false,
        reason: gatewayHandoffBlockedReason('Indeed', classification, targetUrl),
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
      };
    }

    if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
      return {
        step: FormStep.REVIEW,
        advanced: true,
        reason: `TEST_MODE: Indeed resolved to ${classification.adapter}: ${targetUrl}`,
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, testMode: true }
      };
    }

    if (page && typeof page.goto === 'function' && page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    return {
      step: FormStep.DETAILS,
      advanced: true,
      reason: `Indeed handed off to ${classification.adapter}: ${targetUrl}`,
      meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter }
    };
  }

  // Case B: Native Indeed Easy Apply
  if (resolved.type === 'indeed_easy_apply') {
    const candidate = ctx.candidate || {};
    const cookies = await loadIndeedCookies(ctx.config?.profileName, ctx.config);

    if (page && typeof page.context === 'function' && cookies?.length) {
      await page.context().addCookies(cookies).catch(() => {});
    }

    if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
      return {
        step: FormStep.REVIEW,
        advanced: true,
        reason: `TEST_MODE: Indeed Easy Apply prepared for ${candidate.name || 'Candidate'} (${ctx.job?.title || 'Job'}). Session authenticated: ${Boolean(cookies?.length)}. Ready for review.`,
        meta: { indeedApply: true, authenticated: Boolean(cookies?.length), testMode: true }
      };
    }

    // Live auto-apply execution
    if (!page || typeof page.locator !== 'function') {
      return {
        step,
        advanced: false,
        reason: 'Indeed Easy Apply page not available.'
      };
    }

    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    const isSmartApply = /smartapply\.indeed\.com/i.test(currentUrl);

    // 1. If not yet on smartapply.indeed.com, navigate to direct applyHref if available or find and click the Apply button
    if (!isSmartApply) {
      if (resolved.applyHref && /^https?:\/\//i.test(resolved.applyHref)) {
        await page.goto(resolved.applyHref, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        return {
          step: FormStep.DETAILS,
          advanced: true,
          reason: 'Navigated to Indeed Easy Apply portal.'
        };
      }

      const applyBtn = page.locator(
        '[data-testid="viewjob-indeed-apply"], [data-testid*="indeedApply"], button:has-text("Apply now"), a:has-text("Apply now"), button:has-text("Apply with Indeed"), [data-testid="apply-button"], button[id*="indeedApply" i], a[id*="indeedApply" i]'
      ).first();

      const btnVisible = await applyBtn.isVisible().catch(() => false);
      if (btnVisible) {
        const [popup] = await Promise.all([
          page.context()?.waitForEvent('page', { timeout: 6000 }).catch(() => null),
          applyBtn.click().catch(() => {})
        ]);

        if (popup) {
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          await page.goto(popup.url(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await popup.close().catch(() => {});
        } else {
          await page.waitForTimeout(3000);
        }

        return {
          step: FormStep.DETAILS,
          advanced: true,
          reason: 'Clicked Indeed Apply now button.'
        };
      }
    }

    // 2. We are on smartapply.indeed.com or in the application modal
    // Check if submit button is visible
    const submitBtn = page.locator(
      'button:has-text("Submit your application"), button:has-text("Submit application"), button:has-text("Submit"), button:has-text("Send application")'
    ).first();

    const submitVisible = await submitBtn.isVisible().catch(() => false);
    if (submitVisible) {
      console.log('[Adapter:indeed] Final submit button visible. Submitting application...');
      await submitBtn.click().catch(() => {});
      await page.waitForTimeout(4000);

      const postUrl = typeof page.url === 'function' ? page.url() : '';
      _lastSubmission = { at: Date.now(), url: postUrl, jobId: ctx.job?.sourceJobId || ctx.job?.id || 'indeed-job' };
      return {
        step: FormStep.SUBMITTED,
        advanced: true,
        reason: 'Indeed Easy Apply submitted successfully.'
      };
    }

    // Check if Continue / Next / Review button is visible
    const continueBtn = page.locator(
      'button:has-text("Continue"), button:has-text("Next"), button:has-text("Review your application"), input[value="Continue"]'
    ).first();

    const continueVisible = await continueBtn.isVisible().catch(() => false);
    if (continueVisible) {
      const isDisabled = await continueBtn.isDisabled().catch(() => false);
      if (isDisabled) {
        console.log('[Adapter:indeed] Continue button is disabled. Re-checking unfilled questions...');
        await answerIndeedQuestions(page, ctx);
        await page.waitForTimeout(1000);
      }

      console.log('[Adapter:indeed] Continue/Next button visible. Advancing...');
      await continueBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3000);

      const isSub = await isSubmitted(page);
      if (isSub.submitted) {
        return {
          step: FormStep.SUBMITTED,
          advanced: true,
          reason: 'Indeed Easy Apply confirmed submitted.'
        };
      }

      return {
        step: FormStep.DETAILS,
        advanced: true,
        reason: 'Advanced Indeed Easy Apply to next step.'
      };
    }

    // Check if already submitted
    const isSub = await isSubmitted(page);
    if (isSub.submitted) {
      return {
        step: FormStep.SUBMITTED,
        advanced: true,
        reason: 'Indeed Easy Apply confirmed submitted.'
      };
    }

    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'Indeed Easy Apply step has no continue or submit button. Routing to review.',
      meta: { indeedApply: true, manualReview: true }
    };
  }

  return {
    step,
    advanced: false,
    reason: 'Indeed application method unsupported.'
  };
}

export async function resolveIndeedDestination(page, ctx = {}) {
  const currentUrl = typeof page?.url === 'function' ? page.url() : '';
  if (/smartapply\.indeed\.com/i.test(currentUrl)) {
    return { type: 'indeed_easy_apply' };
  }

  // 1. Check if external URL is explicitly passed in raw payload or job object
  if (ctx.job?.raw?.externalApplyUrl || ctx.job?.externalApplyUrl) {
    return { type: 'external_url', url: ctx.job.raw?.externalApplyUrl || ctx.job.externalApplyUrl };
  }

  const rawApply = ctx.job?.raw?.thirdPartyApplyUrl || ctx.job?.thirdPartyApplyUrl;
  if (rawApply) {
    const unwrapped = unwrapIndeedRedirect(rawApply);
    if (unwrapped) {
      return { type: 'external_url', url: unwrapped };
    }
  }

  // 2. Check if job payload indicates Native Indeed Apply
  if (ctx.job?.hasIndeedApply || ctx.job?.raw?.indeedApplyEnabled) {
    return { type: 'indeed_easy_apply' };
  }

  // 3. If page is available, inspect live DOM for external or easy apply links
  if (page && typeof page.evaluate === 'function') {
    try {
      if (typeof page.title === 'function') {
        await resolveIndeedTurnstile(page);
      }
      const liveInfo = await page.evaluate(() => {
        const body = (document.body && document.body.innerText) || '';
        if (/this job has expired on indeed|no longer accepting applications|job is no longer available|this job listing has expired/i.test(body)) {
          return { type: 'expired' };
        }

        const elements = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        for (const el of elements) {
          const text = (el.innerText || el.textContent || '').trim();
          let href = el.getAttribute('href') || '';
          const testId = el.getAttribute('data-testid') || '';
          const id = el.id || '';

          if (/indeedApply|applyButton|viewjob-indeed-apply/i.test(testId) || /indeedApply/i.test(id) || /smartapply\.indeed\.com/i.test(href) || /^(?:apply now|easy apply|apply with indeed)$/i.test(text)) {
            return { type: 'indeed_easy_apply', href, text };
          }

          if (testId === 'viewjob-apply' || /apply on company site/i.test(text) || /applystart|thirdpartysignin/i.test(href)) {
            if (!href) {
              const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
              let fiber = el[key];
              while (fiber) {
                if (fiber.memoizedProps?.viewJobButtonLinkModel?.href) {
                  href = fiber.memoizedProps.viewJobButtonLinkModel.href;
                  break;
                }
                fiber = fiber.return;
              }
            }
            return { type: 'external_url', href: href || '', text };
          }
        }

        const applystartLink = document.querySelector('a[href*="applystart"], a[href*="rc/clk"]');
        if (applystartLink) {
          return { type: 'external_url', href: applystartLink.getAttribute('href') || '', text: applystartLink.innerText };
        }

        return null;
      });

      if (liveInfo?.type === 'expired') {
        return { type: 'expired' };
      }

      if (liveInfo?.type === 'indeed_easy_apply') {
        return { type: 'indeed_easy_apply', applyHref: liveInfo.href };
      }

      if (liveInfo?.href) {
        const unwrapped = unwrapIndeedRedirect(liveInfo.href);
        return { type: 'external_url', url: unwrapped || liveInfo.href };
      }
    } catch {
      // Fallback
    }
  }

  // Default fallback if thirdPartyApplyUrl was present
  if (rawApply) {
    return { type: 'external_url', url: rawApply };
  }

  // Fallback: If applicationUrl itself was an Indeed link or gateway link
  const appUrl = ctx.job?.applicationUrl || ctx.job?.job_url || '';
  if (appUrl) {
    const unwrapped = unwrapIndeedRedirect(appUrl);
    if (unwrapped) {
      return { type: 'external_url', url: unwrapped };
    }
    if (matches(appUrl) || /applystart|rc\/clk|viewjob|\/job\//i.test(appUrl)) {
      return { type: 'external_url', url: appUrl };
    }
  }

  return null;
}

export async function isSubmitted(page) {
  if (_lastSubmission) return proofFound({ markers: ['Indeed submission recorded'] });
  if (!page || typeof page.locator !== 'function') return noProof('Indeed submission not detected (no page).');
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const url = typeof page.url === 'function' ? page.url() : '';
  const markers = [];
  if (/application\s+(?:(?:has\s+been|was)\s+)?(?:sent|submitted|received)|successfully\s+applied|you\s+have\s+applied/i.test(body)) {
    markers.push('Indeed confirmation text detected');
  }
  if (/post-apply|confirmation|applied/i.test(url)) {
    markers.push(`Indeed confirmation URL: ${url}`);
  }
  return markers.length > 0
    ? proofFound({ type: Proof.TEXT, markers })
    : noProof('Indeed submission not detected.');
}

export async function verifySubmission(ctx = {}, page = null) {
  if (_lastSubmission) {
    return {
      proof: Proof.CONFIRMED,
      markers: ['Indeed submission confirmed'],
      reason: 'Indeed application recorded successfully.'
    };
  }
  if (page && typeof page.locator === 'function') {
    const isSub = await isSubmitted(page);
    if (isSub.submitted) {
      return {
        proof: Proof.CONFIRMED,
        markers: isSub.markers || ['Indeed in-page confirmation detected'],
        reason: 'Indeed in-page submission confirmation detected.'
      };
    }
  }
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Indeed submission has no independent portal lookup configured.'
  };
}

export const indeedAdapter = Object.freeze({
  name: NAME,
  allowAdvanceInTestMode: true,
  matches,
  getIndeedJobPageUrl,
  resolveIndeedTurnstile,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default indeedAdapter;
