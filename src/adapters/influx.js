import fs from 'node:fs/promises';
import path from 'node:path';
import { FormStep, Proof, noProof, proofFound } from './types.js';

const NAME = 'influx';
const MAX_STEPS = 40;
const MAX_FLOW_MS = 45000;

function matches(url) {
  return /influx\.com\/forms\//i.test(String(url || '')) || /influx\.typeform\.com\//i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const frame = await getTypeformFrame(page);
  const state = await readTypeformState(frame);
  if (hasSubmissionText(state.body)) return FormStep.SUBMITTED;
  if (/submit/i.test(state.currentText)) return FormStep.REVIEW;
  if (state.currentInputType === 'email' || /email/i.test(state.currentText)) return FormStep.EMAIL;
  if (state.currentQa) return FormStep.DETAILS;
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  const frame = await getTypeformFrame(page);
  await writeDiagnostic(ctx, frame, 'initial');
  const deadline = Date.now() + MAX_FLOW_MS;
  let state = await readTypeformState(frame);
  let lastSignature = '';
  let stagnantSteps = 0;

  for (let guard = 0; guard < MAX_STEPS; guard += 1) {
    if (Date.now() > deadline) throw new Error(`Influx Typeform exceeded ${MAX_FLOW_MS / 1000}s flow timeout.`);
    state = await readTypeformState(frame);
    const signature = `${state.currentQa}|${state.currentText.slice(0, 120)}|${state.currentValue}`;
    if (signature === lastSignature) stagnantSteps += 1;
    else stagnantSteps = 0;
    lastSignature = signature;

    if (stagnantSteps > 4) {
      await writeDiagnostic(ctx, frame, 'stagnant', state);
      throw manualReviewError(`Influx Typeform made no progress at: ${state.currentText.slice(0, 120)}`);
    }
    if (isTerminalState(state)) return;
    if (isIntroStatement(state)) {
      await advanceTypeform(frame);
      continue;
    }

    if (isFinalSubmitState(state)) {
      if (ctx.config?.testMode || ctx.config?.noRealSubmission) return;
      await advanceTypeform(frame);
      continue;
    }

    if (await resolveValidationChoice(frame, state, ctx)) {
      await advanceTypeform(frame);
      continue;
    }

    if ((ctx.config?.testMode || ctx.config?.noRealSubmission) && isLastQuestion(state)) return;

    await answerCurrentQuestion(frame, state, ctx);
    await advanceTypeform(frame);
  }

  throw new Error(`Influx Typeform exceeded ${MAX_STEPS} steps.`);
}

async function advance(page, step, ctx) {
  const frame = await getTypeformFrame(page);
  const before = await readTypeformState(frame);

  if (!ctx.config?.testMode && !ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'Influx real submit is disabled until Typeform submission proof/re-verification is implemented.',
      meta: { currentText: before.currentText }
    };
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: Influx Typeform filled and stopped before final submit.',
      meta: { currentText: before.currentText }
    };
  }

  if (!isFinalSubmitState(before)) {
    return {
      step: FormStep.REVIEW,
      advanced: false,
      reason: 'Influx Typeform filled but final submit button was not detected.',
      meta: { currentText: before.currentText }
    };
  }

  await advanceTypeform(frame);
  await page.waitForTimeout(3000);
  const submitted = await isSubmitted(page);
  return {
    step: submitted.submitted ? FormStep.SUBMITTED : FormStep.REVIEW,
    advanced: submitted.submitted,
    reason: submitted.reason || submitted.markers?.join(', ') || ''
  };
}

async function isSubmitted(page) {
  const frame = await getTypeformFrame(page).catch(() => null);
  const body = frame ? (await frame.locator('body').innerText({ timeout: 5000 }).catch(() => '')) : '';
  const markers = [];
  if (hasSubmissionText(body)) {
    markers.push('Influx Typeform confirmation text detected');
  }
  return markers.length ? proofFound(markers) : noProof('No Influx Typeform confirmation text detected.');
}

async function verifySubmission(ctx) {
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Influx Typeform has no safe independent re-verification endpoint configured.'
  };
}

async function getTypeformFrame(page) {
  await page.waitForTimeout(2000);
  let frame = page.frames().find((candidate) => /influx\.typeform\.com|form\.typeform\.com|typeform\.com/i.test(candidate.url()));

  if (!frame && /influx\.com\/forms\//i.test(page.url())) {
    const formId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
    const query = new URL(page.url()).search;
    if (formId) {
      await page.goto(`https://influx.typeform.com/to/${formId}${query}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      frame = page.mainFrame();
    }
  }

  if (!frame) throw new Error('Influx Typeform iframe was not found.');
  await frame.locator('body').waitFor({ state: 'attached', timeout: 15000 });
  await frame.waitForFunction(
    () => document.body.innerText.trim().length > 0 || document.querySelector('[data-qa*="blocktype-"]'),
    null,
    { timeout: 30000 }
  ).catch(() => {});
  return frame;
}

async function readTypeformState(frame) {
  return frame.evaluate(() => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const blocks = [...document.querySelectorAll('[data-qa*="blocktype-"]')].map((block, index) => ({
      index,
      qa: block.getAttribute('data-qa') || '',
      focused: block.querySelector('[data-qa-focused="true"]') !== null || block.getAttribute('data-qa-focused') === 'true',
      text: (block.innerText || '').trim(),
      inputs: [...block.querySelectorAll('input, textarea')].filter(visible).map((input) => ({
        type: input.getAttribute('type') || input.tagName.toLowerCase(),
        value: input.value || '',
        placeholder: input.getAttribute('placeholder') || ''
      })),
      buttons: [...block.querySelectorAll('button, [role="button"]')].filter(visible).map((button) => ({
        text: (button.innerText || button.textContent || '').trim(),
        aria: button.getAttribute('aria-label') || ''
      }))
    }));
    const visibleInputs = [...document.querySelectorAll('input, textarea')].filter(visible).map((input) => ({
      type: input.getAttribute('type') || input.tagName.toLowerCase(),
      value: input.value || '',
      placeholder: input.getAttribute('placeholder') || ''
    }));
    const visibleButtons = [...document.querySelectorAll('button, [role="button"]')].filter(visible).map((button) => ({
      text: (button.innerText || button.textContent || '').trim(),
      aria: button.getAttribute('aria-label') || ''
    }));
    const current = blocks.find((block) => block.focused) || blocks.at(-1) || null;
    const body = document.body.innerText || '';
    const fallbackQuestion = inferCurrentQuestionFromBody(body, visibleInputs, visibleButtons);
    return {
      body,
      currentQa: current?.qa || fallbackQuestion.qa,
      currentIndex: current?.index ?? -1,
      currentText: current?.text || fallbackQuestion.text,
      currentInputType: current?.inputs?.at(-1)?.type || visibleInputs.at(-1)?.type || '',
      currentPlaceholder: current?.inputs?.at(-1)?.placeholder || visibleInputs.at(-1)?.placeholder || '',
      currentValue: current?.inputs?.at(-1)?.value || visibleInputs.at(-1)?.value || '',
      currentButtons: current?.buttons?.length ? current.buttons : visibleButtons,
      blockCount: blocks.length
    };

    function inferCurrentQuestionFromBody(text, inputs, buttons) {
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      const numbered = lines.filter((line) => /^\d+\b/.test(line));
      const latestNumbered = numbered.at(-1) || '';
      const latestRequired = [...lines].reverse().find((line) => /\*$/.test(line));
      const buttonText = buttons.map((button) => button.text).join(' ');
      if (inputs.length > 0) {
        return { qa: `fallback-${inputs.at(-1).type || 'input'}`, text: latestRequired || latestNumbered || lines.at(-1) || '' };
      }
      if (/start/i.test(buttonText)) return { qa: 'fallback-start', text };
      return { qa: 'fallback-statement', text: latestRequired || latestNumbered || lines.at(-1) || '' };
    }
  });
}

async function writeDiagnostic(ctx, frame, label, state = null) {
  if (!ctx?.debugDir) return;
  await fs.mkdir(ctx.debugDir, { recursive: true }).catch(() => {});
  const payload = {
    at: new Date().toISOString(),
    frameUrl: frame.url(),
    state: state || await readTypeformState(frame).catch((error) => ({ error: error.message }))
  };
  await fs.writeFile(
    path.join(ctx.debugDir, `influx-${label}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  ).catch(() => {});
}

function isIntroStatement(state) {
  return (/blocktype-statement|fallback-start|fallback-statement/i.test(state.currentQa) || /start$/i.test(state.body.trim())) &&
    !/submit/i.test(state.currentText);
}

function isFinalSubmitState(state) {
  return /\bsubmit\b/i.test(`${state.currentText} ${state.currentButtons.map((button) => button.text).join(' ')}`);
}

function isTerminalState(state) {
  return hasSubmissionText(state.body);
}

function hasSubmissionText(body) {
  return /thanks? for applying|thank you for (?:applying|your application|your response|your submission)|application (?:has been |was )?(?:received|submitted)|successfully submitted|response (?:has been |was )?submitted|we['’]?ll be in touch|hopefully that didn['’]?t take too long/i.test(body);
}

function isLastQuestion(state) {
  return state.blockCount > 0 && state.currentIndex >= state.blockCount - 1;
}

async function answerCurrentQuestion(frame, state, ctx) {
  if (/blocktype-(multiple_choice|yes_no|dropdown|picture_choice|opinion_scale|rating)/i.test(state.currentQa)) {
    await chooseOption(frame, state, ctx);
    return;
  }

  const answer = answerForState(state, ctx);
  if (!answer) {
    if (/skype|laptop specs|days a week|hours a day/i.test(state.currentText)) {
      throw manualReviewError(`Influx requires a configured answer for: ${state.currentText.slice(0, 160)}`);
    }
    return;
  }

  const input = frame.locator('[data-qa-focused="true"] input, [data-qa-focused="true"] textarea').last();
  if ((await input.count().catch(() => 0)) > 0) {
    const type = await input.getAttribute('type').catch(() => '');
    if (type === 'file') {
      await handleFileUpload(input, state, ctx);
    } else {
      await input.fill(answer, { timeout: 10000 });
    }
  } else {
    const fallbackInput = frame.locator('input:visible, textarea:visible').last();
    if ((await fallbackInput.count().catch(() => 0)) > 0) {
      const type = await fallbackInput.getAttribute('type').catch(() => '');
      if (type === 'file') {
        await handleFileUpload(fallbackInput, state, ctx);
      } else {
        await fallbackInput.fill(answer, { timeout: 10000 });
      }
    } else {
      await frame.page().keyboard.type(answer);
    }
  }
  await frame.page().waitForTimeout(300);
}

async function handleFileUpload(input, state, ctx) {
  const prompt = String(state.currentText || '').toLowerCase();
  if (/voice|audio|recording|video|vocaroo|loom/.test(prompt)) {
    if (!ctx.config?.voiceRecordingPath) {
      throw manualReviewError('Influx requires a personal voice/audio recording upload, but no recording path is configured.');
    }
    await input.setInputFiles(ctx.config.voiceRecordingPath, { timeout: 10000 });
    return;
  }
  if (!/resume|cv|curriculum vitae/.test(prompt)) {
    throw manualReviewError('Influx requires an unsupported file upload. Manual review is required.');
  }
  if (!ctx.resumePath) {
    throw manualReviewError('Influx requires a resume upload, but no resume path is configured.');
  }
  await input.setInputFiles(ctx.resumePath, { timeout: 10000 });
}

function manualReviewError(message) {
  const error = new Error(message);
  error.manualReview = true;
  return error;
}

async function chooseOption(frame, state, ctx) {
  const answer = normalizeOptionText(answerForState(state, ctx));
  const option = state.currentButtons.find((button) =>
    button.text && !/ok|continue|submit/i.test(button.text) && (
      answer === normalizeOptionText(button.text) ||
      answer.includes(normalizeOptionText(button.text)) ||
      normalizeOptionText(button.text).includes(answer)
    )
  );

  if (!option) {
    if (await clickChoiceByAnswer(frame, answer)) return;
    throw manualReviewError(`Influx requires a manual choice for: ${state.currentText.slice(0, 160)}`);
  }

  await frame.getByText(option.text, { exact: true }).first().click({ force: true }).catch(async () => {
    await frame.page().keyboard.press('A');
  });
  await frame.page().waitForTimeout(300);
}

async function resolveValidationChoice(frame, state, ctx) {
  if (!/please make a selection/i.test(state.body || '')) return false;
  const defaults = ctx.config?.applicationDefaults || ctx.config?.preferences?.applicationDefaults || {};
  let answer = '';
  if (/voice.*phone agent|phone agent|taking and making calls/i.test(state.body)) {
    answer = defaults.voiceAgentAvailability || 'Yes';
  } else if (/weekend|saturday|sunday/i.test(state.body)) {
    answer = defaults.weekendWillingnessScale || defaults.weekendAvailability || '';
  } else if (/short time project-based contract|long term\/permanent contract|long term offers/i.test(state.body)) {
    answer = defaults.contractPreference || 'I will only accept long term offers';
  }
  if (!answer) return false;
  return clickChoiceByAnswer(frame, normalizeOptionText(answer));
}

async function clickChoiceByAnswer(frame, answer) {
  if (answer === 'yes' || answer === 'no') {
    const label = answer === 'yes' ? /^yes$/i : /^no$/i;
    const roleClicked = await frame.getByRole('button', { name: label }).first().click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
    if (roleClicked) return true;
    const textClicked = await frame.getByText(label).first().click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
    if (textClicked) return true;
    await frame.page().keyboard.press(answer === 'yes' ? 'Y' : 'N');
    await frame.page().waitForTimeout(300);
    return true;
  }
  if (/^[1-9]$/.test(answer)) {
    const exactClicked = await frame
      .getByText(new RegExp(`^${answer}$`))
      .first()
      .click({ force: true, timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (exactClicked) {
      await frame.page().waitForTimeout(300);
      return true;
    }
    await frame.page().keyboard.press(answer);
    await frame.page().waitForTimeout(300);
    return true;
  }
  const escapedAnswer = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelClicked = await frame
    .getByText(new RegExp(escapedAnswer, 'i'))
    .first()
    .click({ force: true, timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (labelClicked) return true;
  if (/only accept long term offers/.test(answer)) {
    await frame.page().keyboard.press('E');
    await frame.page().waitForTimeout(300);
    return true;
  }
  if (/prefer long term offers/.test(answer)) {
    await frame.page().keyboard.press('D');
    await frame.page().waitForTimeout(300);
    return true;
  }
  return false;
}

function normalizeOptionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+[a-z0-9]$/, '')
    .trim();
}

async function advanceTypeform(frame) {
  const before = await typeformSignature(frame);
  let button = frame
    .locator('[data-qa-focused="true"] button:visible, [data-qa-focused="true"] [role="button"]:visible')
    .filter({ hasText: /^(start|ok|continue|submit)$/i })
    .last();
  if ((await button.count().catch(() => 0)) === 0) {
    button = frame
      .locator('button:visible, [role="button"]:visible')
      .filter({ hasText: /^(start|ok|continue|submit)$/i })
      .last();
  }
  if ((await button.count().catch(() => 0)) > 0) {
    const clicked = await button.click({ force: true, timeout: 5000 }).then(() => true).catch(() => false);
    if (clicked && await waitForTypeformAdvance(frame, before)) return;
  }

  const rect = await frame.evaluate(() => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
    const primary = [...buttons].reverse().find((button) =>
      /^(start|ok|continue|submit)$/i.test((button.innerText || button.textContent || '').trim())
    );
    if (!primary) return null;
    const box = primary.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }).catch(() => false);

  if (rect) {
    await frame.page().mouse.move(rect.x, rect.y);
    await frame.page().mouse.click(rect.x, rect.y);
    if (await waitForTypeformAdvance(frame, before)) return;
  }

  await frame.page().keyboard.press('Enter');
  await waitForTypeformAdvance(frame, before);
}

async function typeformSignature(frame) {
  return frame.evaluate(() => {
    const focused = document.querySelector('[data-qa-focused="true"]');
    const body = document.body.innerText || '';
    return `${focused?.id || ''}|${focused?.innerText || ''}|${body.slice(-300)}`;
  }).catch(() => '');
}

async function waitForTypeformAdvance(frame, before) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await frame.page().waitForTimeout(200);
    if (await typeformSignature(frame) !== before) return true;
  }
  return false;
}

function answerForState(state, ctx) {
  const text = String(state.currentText || '').toLowerCase();
  const candidate = ctx.candidate || {};
  const config = ctx.config || {};
  const defaults = config.applicationDefaults || config.preferences?.applicationDefaults || {};
  const answers = ctx.answers || {};

  if (/full name|name\*|first, some basic details|please answer the following questions by writing/i.test(text)) {
    return defaults.fullName || candidate.name || config.displayName || '';
  }
  if (/email/i.test(text)) return config.applicantEmail || candidate.email || '';
  if (/voice.*phone agent|phone agent|taking and making calls/i.test(text)) return defaults.voiceAgentAvailability || '';
  if (/phone|mobile|whatsapp/i.test(text)) return normalizePhone(defaults.phone || candidate.phone || config.phone || '');
  if (/skype/i.test(text)) return defaults.skypeHandle || '';
  if (/location|city|country|where.*live/i.test(text)) return candidate.location || defaults.city || defaults.country || '';
  if (/linkedin|twitter|facebook|github|blog|profile/i.test(text)) return candidate.linkedin || candidate.website || 'N/A';
  if (/what did you study|tell us about your education/i.test(text)) return formatEducation(candidate);
  if (/when did you graduate|graduation/i.test(text)) return candidate.education?.[0]?.year || defaults.graduationYear || '';
  if (/enjoy.*university/i.test(text)) return answers.university_experience || answers.general || defaults.universityHighlight || '';
  if (/toefl|ielts/i.test(text)) return defaults.englishTestScore || 'N/A';
  if (/describe your professional experience|background in \*?technical support/i.test(text)) {
    return answers.describe_experience || answers.relevant_skills || answers.general || formatWorkHistory(candidate);
  }
  if (/web developer/i.test(text)) return 'No';
  if (/css required.*orange buttons.*purple/i.test(text)) return '.button { background-color: purple; }';
  if (/how did you hear/i.test(text)) return defaults.referralSource || '';
  if (/fast track/i.test(text)) return defaults.fastTrackOptIn || 'No';
  if (/customer support.*service experience|how many years.*customer.*support|salary expectation/i.test(text)) {
    return answers.describe_experience || answers.general || formatSupportExperience(candidate, defaults);
  }
  if (/days a week|hours a day/i.test(text)) return defaults.workSchedule || '';
  if (/short time project-based contract|long term\/permanent contract/i.test(text)) {
    return defaults.contractPreference || 'I will only accept long term offers';
  }
  if (/scale of 1-6.*(?:weekend|outside.*normal|working hours|normal working hours|uncertain roster|rosters?)/i.test(text)) return defaults.weekendWillingnessScale || '';
  if (/weekend|saturday|sunday/i.test(text)) return defaults.weekendAvailability || '';
  if (/operating system/i.test(text)) return defaults.laptopOperatingSystem || '';
  if (/do you have a laptop|laptop specs|tell us the laptop specs/i.test(text)) return defaults.laptopSpecs || '';
  if (/internet.*speed|connection speed|mbps/i.test(text)) return defaults.internetSpeed || '';
  if (/resume|cv/i.test(text)) return candidate.resumeUrl || 'Resume available on request.';
  if (/english/i.test(text)) return 'Yes';
  if (/internet|workspace|computer|laptop|headset|equipment/i.test(text)) return 'Yes';
  if (/start|available|availability|notice/i.test(text)) return 'I am available to start immediately.';
  if (/experience|background|customer|support|call|chat|email/i.test(text)) {
    return answers.describe_experience || answers.relevant_skills || answers.general ||
      'I have experience in customer support, administrative support, inbox management, CRM support, data entry, and clear written communication. I am calm, organized, and comfortable helping customers solve problems remotely.';
  }
  if (/why|fit|hire|interested|motivat/i.test(text)) {
    return answers.why_good_fit || answers.why_this_role || answers.general ||
      'I am interested in this role because it matches my strengths in customer support, communication, organization, and remote work. I learn tools quickly and take care to give customers clear, helpful responses.';
  }
  if (/salary|pay|compensation/i.test(text)) return 'Open to the role budget';

  return answers.general ||
    'I bring strong communication, organization, attention to detail, and customer support skills. I am comfortable working remotely, learning new tools, and helping customers with patience and accuracy.';
}

function formatEducation(candidate) {
  const education = candidate.education || [];
  if (!education.length) return 'BSc. Human Kinetics, Ahmadu Bello University, 2025.';
  return education
    .map((item) => [item.degree, item.institution, item.year].filter(Boolean).join(', '))
    .join('; ');
}

function formatWorkHistory(candidate) {
  const workHistory = candidate.workHistory || [];
  if (!workHistory.length) return '';
  return workHistory
    .slice(0, 4)
    .map((item) => {
      const heading = [item.jobTitle, item.company, [item.startDate, item.endDate].filter(Boolean).join('-')].filter(Boolean).join(' at ');
      const responsibilities = (item.responsibilities || []).slice(0, 3).join(' ');
      return `${heading}. ${responsibilities}`.trim();
    })
    .join(' ');
}

function formatSupportExperience(candidate, defaults) {
  const relevantRole = (candidate.workHistory || []).find((item) => /assistant|support|customer/i.test(item.jobTitle || ''));
  const roleSummary = relevantRole
    ? `My experience includes my role as ${relevantRole.jobTitle} at ${relevantRole.company}, where ${(relevantRole.responsibilities || []).slice(0, 2).join(' ')}`
    : 'I have customer support and administrative support experience.';
  return `${roleSummary} My salary expectation is ${defaults.expectedSalary || 'open to the role budget'}.`;
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length >= 10) return `+234${digits.slice(1)}`;
  if (raw.startsWith('+')) return raw.replace(/\s+/g, '');
  return raw;
}

export const influxAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default influxAdapter;
