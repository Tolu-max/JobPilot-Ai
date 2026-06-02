import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  ApplicationOutcome,
  ApplicationState,
  createApplicationLifecycle,
  finalizeApplication,
  transitionApplicationState
} from './applicationStateManager.js';
import { hashJob } from './jobStore.js';
import { sendNotification } from './notifications.js';
import { compactText, humanDelay } from './utils.js';
import { solveCaptchaAuto } from './captchaSolver.js';
import { getStealthScript, stealthArgs, stealthUserAgent } from './stealthInit.js';
import { getPlaywrightProxy, markProxyBad } from './proxyRotator.js';
import { getAdapter } from './adapters/index.js';
import { FormStep, Proof } from './adapters/types.js';
import {
  buildGroundedFallbackAnswer,
  cleanApplicationAnswer,
  validateApplicationAnswer
} from './applicationAnswerGuard.js';

export async function attemptApplication(job, coverLetter, config) {
  const { coverLetterText, applicationAnswers } = normalizeApplicationPackage(coverLetter);
  const lifecycle = createApplicationLifecycle(job);
  transitionApplicationState(lifecycle, ApplicationState.SCORED, 'Job passed scoring.');
  transitionApplicationState(lifecycle, ApplicationState.SELECTED_FOR_APPLICATION, 'Job selected for application.');

  const debug = createDebugCollector(job, config);

  if (config.testPlatformMode && config.simulateAutomation !== false) {
    transitionApplicationState(lifecycle, ApplicationState.FORM_OPENED, 'TEST_PLATFORM_MODE simulated form opened.');
    transitionApplicationState(lifecycle, ApplicationState.FORM_FILLED, 'TEST_PLATFORM_MODE simulated form filled.');
    finalizeApplication(
      lifecycle,
      ApplicationState.NEEDS_MANUAL_REVIEW,
      'TEST_PLATFORM_MODE=true: simulated TEST_MODE form fill; submit was not clicked.',
      {
        testPlatformMode: true,
        expectedSuccessSignals: ['URL change', 'confirmation text', 'successful POST response'],
        expectedFailureSignals: ['CAPTCHA', 'validation error', 'stuck spinner', 'submit button still visible']
      }
    );
    await writeSimulatedAutomationArtifacts(debug, job, {
      coverLetterText,
      applicationAnswers,
      lifecycle
    });
    return resultFromLifecycle(lifecycle, debug);
  }

  const preflight = await validateAutoApplyConfig(config);
  if (!preflight.ok) {
    finalizeApplication(lifecycle, ApplicationState.FAILED, preflight.reason);
    await writeLifecycle(debug, lifecycle);
    await writeConsoleLogs(debug);
    return resultFromLifecycle(lifecycle, debug);
  }

  // Get a tested working proxy (or null for direct connection)
  const proxyConfig = await getPlaywrightProxy(config);
  const usedProxy = proxyConfig?.proxy?.server || null;

  let context;
  try {
    context = await chromium.launchPersistentContext(config.browserProfileDir, {
      headless: config.headless,
      viewport: { width: 1366, height: 768 },
      userAgent: stealthUserAgent,
      args: browserArgsForMode(config),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      handleSIGHUP: false,
      ...proxyConfig
    });
  } catch (error) {
    finalizeApplication(lifecycle, ApplicationState.FAILED, `Browser launch failed: ${error.message}`, {
      stack: error.stack,
      browserProfileDir: config.browserProfileDir,
      headless: config.headless
    });
    await writeLifecycle(debug, lifecycle);
    await writeConsoleLogs(debug);
    return resultFromLifecycle(lifecycle, debug);
  }

  await context.addInitScript(getStealthScript());

  try {
    // Clear Google reCAPTCHA cookies to avoid "Try again later" rate limit carry-over
    await context.clearCookies({ domain: '.google.com' }).catch(() => {});
    await context.clearCookies({ domain: '.gstatic.com' }).catch(() => {});
    await context.clearCookies({ domain: '.recaptcha.net' }).catch(() => {});

    let page = await context.newPage();
    collectConsoleLogs(page, debug);

    await page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await humanDelay(config);
    page = await openApplicationFormIfNeeded(page, config);
    transitionApplicationState(lifecycle, ApplicationState.FORM_OPENED, 'Application form opened.');
    await saveDebugArtifacts(page, debug, '01-form-opened');

    const formSafety = await inspectFormSafety(page);
    if (!formSafety.ok) {
      if (formSafety.captcha) {
        const captchaResult = await waitForCaptchaSolve(page, config, job, debug);
        if (!captchaResult.ok) {
          finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, captchaResult.reason, captchaResult);
          await saveDebugArtifacts(page, debug, '07-after-submit');
          await writeLifecycle(debug, lifecycle);
          return resultFromLifecycle(lifecycle, debug);
        }
      } else {
        const state = formSafety.manualReview ? ApplicationState.NEEDS_MANUAL_REVIEW : ApplicationState.FAILED;
        finalizeApplication(lifecycle, state, formSafety.reason, formSafety);
        await saveDebugArtifacts(page, debug, '07-after-submit');
        await writeLifecycle(debug, lifecycle);
        return resultFromLifecycle(lifecycle, debug);
      }
    }

    // Navigate through all form steps (multi-step or single-step forms)
    // Adapter selection: site-specific adapters (e.g. bruntwork) use their own
    // step-by-step navigation + proof check + ground-truth re-verification.
    // Generic adapter falls back to navigateMultiStepForm for everything else.
    const adapter = getAdapter(job.applicationUrl || page.url());
    const useSiteAdapter = adapter.name !== 'generic';

    if (useSiteAdapter) {
      console.log(`[Automation] Using site-specific adapter: ${adapter.name}`);
      const adapterResult = await runSiteAdapterFlow({
        adapter,
        page,
        config,
        coverLetterText,
        applicationAnswers,
        job,
        debug,
        lifecycle
      });
      await writeLifecycle(debug, lifecycle);
      return adapterResult;
    }

    const formNav = await navigateMultiStepForm(page, config, coverLetterText, applicationAnswers, job, debug);
    transitionApplicationState(lifecycle, ApplicationState.FORM_FILLED, 'Application form fields were filled.');
    await saveDebugArtifacts(page, debug, '06-before-submit');

    if (!formNav.ok) {
      if (formNav.alreadyApplied) {
        transitionApplicationState(lifecycle, ApplicationState.SUBMITTED, formNav.reason);
        finalizeApplication(lifecycle, ApplicationState.CONFIRMED_SUCCESS, formNav.reason, formNav);
        await saveDebugArtifacts(page, debug, '07-after-submit');
        await writeLifecycle(debug, lifecycle);
        return resultFromLifecycle(lifecycle, debug);
      }
      const state = formNav.captchaBlocked || formNav.manualReview
        ? ApplicationState.NEEDS_MANUAL_REVIEW
        : ApplicationState.FAILED;
      finalizeApplication(lifecycle, state, formNav.reason, formNav);
      await saveDebugArtifacts(page, debug, '07-after-submit');
      await writeLifecycle(debug, lifecycle);
      return resultFromLifecycle(lifecycle, debug);
    }

    const submitControl = formNav.submitControl;

    // Final CAPTCHA check right before submit (BruntWork renders reCAPTCHA late)
    await page.waitForTimeout(1500);
    if (await hasCaptcha(page)) {
      console.log('[Automation] CAPTCHA detected on final submit page. Solving...');
      const captchaResult = await waitForCaptchaSolve(page, config, job, debug);
      if (!captchaResult.ok) {
        finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, captchaResult.reason, captchaResult);
        await saveDebugArtifacts(page, debug, '07-after-submit');
        await writeLifecycle(debug, lifecycle);
        return resultFromLifecycle(lifecycle, debug);
      }
    }

    if (config.testMode || config.noRealSubmission) {
      const simulated = simulateConfirmationForTestMode(page);
      const guardLabel = config.noRealSubmission ? 'NO_REAL_SUBMISSION=true' : 'TEST_MODE=true';
      finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, `${guardLabel}: form filled; submit was not clicked.`, simulated);
      await saveDebugArtifacts(page, debug, '07-after-submit');
      await writeLifecycle(debug, lifecycle);
      return resultFromLifecycle(lifecycle, debug);
    }

    const confirmation = await submitAndConfirm(page, submitControl, config);
    transitionApplicationState(lifecycle, ApplicationState.SUBMITTED, 'Submit control was clicked.', confirmation);
    await saveDebugArtifacts(page, debug, '07-after-submit');

    if (confirmation.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) {
      finalizeApplication(lifecycle, ApplicationState.CONFIRMED_SUCCESS, confirmation.reason, confirmation);
    } else if (confirmation.outcome === ApplicationOutcome.APPLICATION_FAILED) {
      finalizeApplication(lifecycle, ApplicationState.FAILED, confirmation.reason, confirmation);
    } else {
      finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, confirmation.reason, confirmation);
    }

    await writeLifecycle(debug, lifecycle);
    return resultFromLifecycle(lifecycle, debug);
  } catch (error) {
    finalizeApplication(lifecycle, ApplicationState.FAILED, `Automation failed: ${error.message}`, {
      stack: error.stack
    });
    await writeLifecycle(debug, lifecycle);
    return resultFromLifecycle(lifecycle, debug);
  } finally {
    await writeConsoleLogs(debug);
    await context.close();
  }
}

// --- Site-specific adapter flow (replaces navigateMultiStepForm + submitAndConfirm for known sites) ---

async function runSiteAdapterFlow({ adapter, page, config, coverLetterText, applicationAnswers, job, debug, lifecycle }) {
  const ctx = {
    config,
    candidate: config.cvData || {},
    resumePath: config.resumePath,
    coverLetter: coverLetterText,
    answers: applicationAnswers,
    job,
    debugDir: debug.dir
  };

  const MAX_STEPS = 15;
  const adapterFlowTimeoutMs = Math.max(30000, Math.min(config.applicationTimeoutMs || 180000, 180000));
  const adapterFillTimeoutMs = Math.min(config.applicationTimeoutMs || 180000, 60000);
  const adapterAdvanceTimeoutMs = Math.min(config.applicationTimeoutMs || 180000, 30000);
  const adapterFlowStartedAt = Date.now();
  let stepCount = 0;
  let activeAdapter = adapter;

  try {
    while (stepCount < MAX_STEPS) {
      if (Date.now() - adapterFlowStartedAt > adapterFlowTimeoutMs) {
        finalizeApplication(
          lifecycle,
          ApplicationState.NEEDS_MANUAL_REVIEW,
          `Adapter ${activeAdapter.name} exceeded flow timeout after ${adapterFlowTimeoutMs}ms.`,
          { timeoutMs: adapterFlowTimeoutMs, stepCount }
        );
        await saveDebugArtifacts(page, debug, '07-after-submit');
        return resultFromLifecycle(lifecycle, debug);
      }

      stepCount += 1;
      const currentStep = await activeAdapter.getCurrentStep(page);
      console.log(`[Adapter:${activeAdapter.name}] Step ${stepCount}: ${currentStep}`);

      // Check if we've reached a submitted state
      if (currentStep === FormStep.SUBMITTED) {
        const check = await activeAdapter.isSubmitted(page);
        if (check.submitted) {
          console.log(`[Adapter:${activeAdapter.name}] Submission markers detected: ${check.markers.join(', ')}`);
          transitionApplicationState(lifecycle, ApplicationState.SUBMITTED, `Adapter detected submission: ${check.markers.join(', ')}`, check);
          await saveDebugArtifacts(page, debug, '07-after-submit');
          break;
        }
      }

      // Handle captcha if present
      if (await hasCaptcha(page)) {
        console.log(`[Adapter:${activeAdapter.name}] CAPTCHA detected at step ${currentStep}. Solving...`);
        const captchaResult = await waitForCaptchaSolve(page, config, job, debug);
        if (!captchaResult.ok) {
          finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, captchaResult.reason, captchaResult);
          await saveDebugArtifacts(page, debug, '07-after-submit');
          return resultFromLifecycle(lifecycle, debug);
        }
        await page.waitForTimeout(1500);
        continue; // Re-check step after captcha solve
      }

      // Fill the current step
      await withAdapterTimeout(
        activeAdapter.fillStep(page, currentStep, ctx),
        adapterFillTimeoutMs,
        `${activeAdapter.name} fillStep timed out`
      );
      await humanDelay(config);
      await saveDebugArtifacts(page, debug, `step-${stepCount}-${currentStep.toLowerCase()}-filled`);
      transitionApplicationState(lifecycle, ApplicationState.FORM_FILLED, `Adapter filled step: ${currentStep}`);

      // Test-mode / no-real-submission guard
      if ((config.testMode || config.noRealSubmission) && !activeAdapter.allowAdvanceInTestMode) {
        const guardLabel = config.noRealSubmission ? 'NO_REAL_SUBMISSION=true' : 'TEST_MODE=true';
        finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, `${guardLabel}: form filled; submit was not clicked.`, { currentStep });
        await saveDebugArtifacts(page, debug, '07-after-submit');
        return resultFromLifecycle(lifecycle, debug);
      }

      // Advance to next step
      const advanceResult = await withAdapterTimeout(
        activeAdapter.advance(page, currentStep, ctx),
        adapterAdvanceTimeoutMs,
        `${activeAdapter.name} advance timed out`
      );
      console.log(`[Adapter:${activeAdapter.name}] Advance result: advanced=${advanceResult.advanced}, reason=${advanceResult.reason || 'none'}`);

      const nextAdapter = getAdapter(page.url());
      if (nextAdapter.name !== 'generic' && nextAdapter.name !== activeAdapter.name) {
        console.log(`[Adapter:${activeAdapter.name}] Handing off to adapter: ${nextAdapter.name}`);
        activeAdapter = nextAdapter;
        await page.waitForTimeout(1000);
        continue;
      }

      if (!advanceResult.advanced) {
        // Stuck — could be validation error, disabled button, or final step reached
        const check = await activeAdapter.isSubmitted(page);
        if (check.submitted) {
          console.log(`[Adapter:${activeAdapter.name}] Submission markers detected after stuck advance: ${check.markers.join(', ')}`);
          transitionApplicationState(lifecycle, ApplicationState.SUBMITTED, `Adapter detected submission: ${check.markers.join(', ')}`, check);
          await saveDebugArtifacts(page, debug, '07-after-submit');
          break;
        }
        // Not submitted and can't advance — manual review
        finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, `Adapter ${activeAdapter.name} stuck at step ${currentStep}: ${advanceResult.reason}`, advanceResult);
        await saveDebugArtifacts(page, debug, '07-after-submit');
        return resultFromLifecycle(lifecycle, debug);
      }

      await page.waitForTimeout(1500);
    }

    if (stepCount >= MAX_STEPS) {
      finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, `Adapter exceeded max steps (${MAX_STEPS}).`);
      await saveDebugArtifacts(page, debug, '07-after-submit');
      return resultFromLifecycle(lifecycle, debug);
    }

    // We've reached SUBMITTED state. Now run ground-truth re-verification.
    transitionApplicationState(lifecycle, ApplicationState.PROOF_PENDING, 'Awaiting ground-truth re-verification.');
    console.log(`[Adapter:${activeAdapter.name}] Running verifySubmission...`);
    const verifyResult = await activeAdapter.verifySubmission(ctx);
    console.log(`[Adapter:${activeAdapter.name}] Verification proof: ${verifyResult.proof}, markers: ${verifyResult.markers.join(', ')}`);

    if (verifyResult.proof === Proof.CONFIRMED) {
      finalizeApplication(lifecycle, ApplicationState.CONFIRMED_SUCCESS, `Ground-truth re-verification CONFIRMED: ${verifyResult.markers.join(', ')}`, verifyResult);
    } else if (verifyResult.proof === Proof.NOT_SUBMITTED) {
      finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, `Ground-truth re-verification FAILED — submission did not stick: ${verifyResult.reason}`, verifyResult);
    } else {
      // INCONCLUSIVE — trust the in-page proof but flag for manual review
      finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, `Re-verification inconclusive: ${verifyResult.reason}. In-page proof was positive but ground truth could not be confirmed.`, verifyResult);
    }

    return resultFromLifecycle(lifecycle, debug);
  } catch (error) {
    const state = error.manualReview ? ApplicationState.NEEDS_MANUAL_REVIEW : ApplicationState.FAILED;
    const reason = error.manualReview ? error.message : `Adapter flow failed: ${error.message}`;
    finalizeApplication(lifecycle, state, reason, { stack: error.stack });
    await saveDebugArtifacts(page, debug, '07-after-submit');
    return resultFromLifecycle(lifecycle, debug);
  }
}

async function withAdapterTimeout(task, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${message} after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function submitAndConfirm(page, submitControl, config) {
  const beforeUrl = page.url();
  const responses = [];
  const onResponse = (response) => {
    const request = response.request();
    if (['POST', 'PUT', 'PATCH'].includes(request.method())) {
      responses.push({
        url: response.url(),
        status: response.status(),
        method: request.method()
      });
    }
  };

  page.on('response', onResponse);
  try {
    await humanDelay(config);
    const clicked = await retryClick(page, submitControl, 3);
    if (!clicked) {
      return failure('Submit button could not be clicked after retries.', { beforeUrl, responses });
    }

    await waitForPostSubmitSettling(page);

    // If a CAPTCHA re-appeared after submit, solve it and retry once
    if (await hasCaptcha(page)) {
      console.log('[Submit] CAPTCHA re-appeared after submit — solving and retrying...');
      await solveCaptchaAuto(page, config);
      await humanDelay(config);
      const submitBtn = await findFinalSubmitControl(page);
      if (submitBtn) {
        await retryClick(page, submitBtn, 2);
        await waitForPostSubmitSettling(page);
      }
    }

    return await evaluateSubmissionState(page, beforeUrl, responses);
  } finally {
    page.off('response', onResponse);
  }
}

async function evaluateSubmissionState(page, beforeUrl, responses) {
  const afterUrl = page.url();
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const successSignals = [];
  const failureSignals = [];

  const urlChanged = afterUrl !== beforeUrl;
  if (urlChanged) successSignals.push(`URL changed from ${beforeUrl} to ${afterUrl}`);

  const hasConfirmationText = /thank\s*you|application\s*(received|submitted|updated|complete)|successfully\s*(submitted|applied)|we have received|we'?ll be in touch|has been updated|application is complete|profile has been/i.test(bodyText);
  if (hasConfirmationText) {
    successSignals.push('Success confirmation text detected.');
  }
  // Only treat URL pattern as confirmation if the URL actually changed (not the form page itself)
  const hasConfirmationUrl = urlChanged && /confirm|success|thank|submitted|complete|\/applications\//i.test(afterUrl);
  if (hasConfirmationUrl) {
    successSignals.push('Confirmation-like URL detected after redirect.');
  }

  const successfulSubmissionResponse = responses.find((response) => response.status >= 200 && response.status < 400);
  if (successfulSubmissionResponse) {
    successSignals.push(`Successful submission network response: ${successfulSubmissionResponse.status}`);
  }

  // STRICTER VALIDATION: For bruntwork specifically, require BOTH URL change AND confirmation text
  // because they have multi-step forms where URL changes mid-flow without actual submission
  const isBruntwork = beforeUrl.includes('bruntwork') || afterUrl.includes('bruntwork');
  if (isBruntwork) {
    // For bruntwork, require explicit confirmation text OR confirmation-like URL pattern
    if (urlChanged && !hasConfirmationText && !hasConfirmationUrl) {
      failureSignals.push('Bruntwork: URL changed but no confirmation text/URL — likely incomplete multi-step form.');
    }
  }

  // Only flag CAPTCHA as failure when no confirmation URL signal was found
  if (successSignals.filter((s) => s.includes('URL')).length === 0 && (await hasCaptcha(page))) {
    failureSignals.push('CAPTCHA detected after submit.');
  }
  // Validation errors + URL didn't change = form was not submitted (still on form page)
  const errorElements = page.locator('.error, [class*="error" i], [class*="invalid" i], [aria-invalid="true"]');
  const visibleErrors = await errorElements.count().catch(() => 0);
  if (visibleErrors > 0) {
    if (!urlChanged) {
      failureSignals.push('Validation errors detected and URL did not change — form not submitted.');
    } else {
      failureSignals.push('Visible validation or error message detected.');
    }
  }
  if (await hasStuckSpinner(page)) failureSignals.push('Loading spinner stayed visible for more than 10 seconds.');

  const submitStillVisible = await hasVisibleSubmitControl(page);
  const formLooksDisabled = await formIsMostlyDisabled(page);
  if (formLooksDisabled && successSignals.length > 0) {
    successSignals.push('Form became disabled after submit.');
  }
  if (submitStillVisible && successSignals.length === 0) {
    failureSignals.push('Submit button is still visible with no success signal.');
  }

  if (successSignals.length > 0 && !failureSignals.includes('CAPTCHA detected after submit.')) {
    return success('Application submission confirmed.', { beforeUrl, afterUrl, successSignals, failureSignals, responses });
  }

  if (failureSignals.length > 0) {
    return failure('Application submission failed or was blocked.', { beforeUrl, afterUrl, successSignals, failureSignals, responses });
  }

  return manualReview('Submission state is unclear after submit.', {
    beforeUrl,
    afterUrl,
    successSignals,
    failureSignals,
    responses
  });
}

async function openApplicationFormIfNeeded(page, config) {
  if (await hasApplicationFields(page)) return page;

  const applyControl = await findApplyControl(page);
  if (applyControl) {
    console.log('[OpenForm] Found apply control, clicking...');

    // Listen for new tabs (target="_blank" links like on WeWorkRemotely)
    const context = page.context();
    const newPagePromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);

    await retryClick(page, applyControl, 3);

    // Check if a new tab opened
    const newPage = await newPagePromise;
    if (newPage) {
      console.log(`[OpenForm] Apply link opened new tab: ${newPage.url()}`);
      await newPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
      await newPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await humanDelay(config);

      // Detect external ATS and pre-fill ATS-specific fields
      const atsPlatform = detectAtsPlatform(newPage.url());
      if (atsPlatform) {
        console.log(`[OpenForm] Detected ATS platform: ${atsPlatform}`);
        await fillAtsPlatformFields(newPage, config, atsPlatform);
      }
      return newPage;
    }

    // Same-tab navigation
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await humanDelay(config);

    // Same-tab ATS detection
    const atsPlatform = detectAtsPlatform(page.url());
    if (atsPlatform) {
      console.log(`[OpenForm] Detected ATS platform (same-tab): ${atsPlatform}`);
      await fillAtsPlatformFields(page, config, atsPlatform);
    }
  }
  return page;
}

/**
 * Fill ATS-platform-specific fields before the generic form filler runs.
 * Each ATS uses different field names / structures.
 */
async function fillAtsPlatformFields(page, config, platform) {
  const cv = config.cvData || {};
  const firstName = cv.firstName || (cv.name || '').split(' ')[0] || '';
  const lastName = cv.lastName || (cv.name || '').split(' ').slice(1).join(' ') || '';
  const email = config.applicantEmail || cv.email || '';
  const phone = cv.phone || '';

  const safeType = async (selector, value) => {
    if (!value) return;
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.fill(value);
        await page.waitForTimeout(300);
      }
    } catch { /* field may not exist on this form */ }
  };

  if (platform === 'lever') {
    // Lever: name, email, phone, org, resume upload
    await safeType('input[name="name"]', `${firstName} ${lastName}`.trim());
    await safeType('input[name="email"]', email);
    await safeType('input[name="phone"]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'greenhouse') {
    // Greenhouse: first_name, last_name, email, phone
    await safeType('#first_name', firstName);
    await safeType('#last_name', lastName);
    await safeType('#email', email);
    await safeType('#phone', phone);
    await uploadResumeToInput(page, '#resume', config.resumePath, config);
  } else if (platform === 'workable') {
    // Workable: React-rendered — use data-ui attributes + name attrs
    await safeType('input[name="firstname"], input[name="first_name"]', firstName);
    await safeType('input[name="lastname"], input[name="last_name"]', lastName);
    await safeType('input[name="email"]', email);
    await safeType('input[name="phone"]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'ashby') {
    // Ashby: _systemfield_ prefixed fields
    await safeType('input[name*="_systemfield_name"], input[name="name"]', `${firstName} ${lastName}`.trim());
    await safeType('input[name*="_systemfield_email"], input[name="email"]', email);
    await safeType('input[name*="_systemfield_phone"], input[name="phone"]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'bamboohr') {
    // BambooHR: standard HTML5 form with labelled inputs
    await safeType('input[id*="firstName" i], input[name*="firstName" i]', firstName);
    await safeType('input[id*="lastName" i], input[name*="lastName" i]', lastName);
    await safeType('input[type="email"]', email);
    await safeType('input[type="tel"]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'smartrecruiters') {
    // SmartRecruiters: firstName / lastName / email
    await safeType('input[id="firstName"], input[name="firstName"]', firstName);
    await safeType('input[id="lastName"], input[name="lastName"]', lastName);
    await safeType('input[id="email"], input[name="email"]', email);
    await safeType('input[id="phoneNumber"], input[name="phoneNumber"]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'teamtailor') {
    await safeType('input[name="candidate[first_name]"], input[name*="first_name" i], input[id*="first-name" i]', firstName);
    await safeType('input[name="candidate[last_name]"], input[name*="last_name" i], input[id*="last-name" i]', lastName);
    await safeType('input[name="candidate[email]"], input[type="email"]', email);
    await safeType('input[name="candidate[phone]"], input[type="tel"]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'personio') {
    await safeType('input[name*="first_name" i], input[id*="first_name" i]', firstName);
    await safeType('input[name*="last_name" i], input[id*="last_name" i]', lastName);
    await safeType('input[type="email"], input[name*="email" i]', email);
    await safeType('input[type="tel"], input[name*="phone" i]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  } else if (platform === 'ultipro' || platform === 'icims' || platform === 'workday' || platform === 'recruitee') {
    await safeType('input[name*="first" i], input[id*="first" i]', firstName);
    await safeType('input[name*="last" i], input[id*="last" i]', lastName);
    await safeType('input[type="email"], input[name*="email" i], input[id*="email" i]', email);
    await safeType('input[type="tel"], input[name*="phone" i], input[id*="phone" i]', phone);
    await uploadResumeToInput(page, 'input[type="file"]', config.resumePath, config);
  }
}

/**
 * Upload a resume PDF to a file input element.
 * Separated so ATS-specific fillers can call it without going through the full uploadResume path.
 */
async function uploadResumeToInput(page, selector, resumePath, config) {
  if (!resumePath) return;
  try {
    const fileInputs = page.locator(selector);
    const count = await fileInputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = fileInputs.nth(i);
      try {
        await el.setInputFiles(resumePath, { timeout: 8000 });
        console.log(`[ATS] Uploaded resume to ${selector} (index ${i})`);
        await page.waitForTimeout(1000);
        return; // upload first match only
      } catch { /* try next */ }
    }
  } catch { /* non-fatal */ }
}

async function findApplyControl(page) {
  const candidates = [
    page.getByRole('link', { name: /apply/i }),
    page.getByRole('button', { name: /apply/i }),
    page.getByText(/apply now|apply/i),
    page.locator('xpath=//a[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply")]'),
    page.locator('xpath=//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply")]')
  ];
  return firstVisible(candidates);
}
async function findFinalSubmitControl(page) {
  // First check if there's a Continue/Next button — if so, we're NOT on the final step
  const hasContinue = await page.locator('button:has-text("Continue"), button:has-text("Next"), button:has-text("Proceed")').first().isVisible().catch(() => false);

  const candidates = [
    // Specific application submit buttons
    page.getByRole('button', { name: /submit\s*application|send\s*application|submit\s*your\s*application/i }),
    // Common apply/submit labels
    page.getByRole('button', { name: /^apply\s*(now)?$|^submit$|^send$|^apply\s*for\s*this\s*job$/i }),
    // Input submit buttons
    page.locator('input[type="submit"]'),
    // Any button with type=submit
    page.locator('button[type="submit"]'),
    // Broader text matches
    page.locator('button:has-text("Apply Now")'),
    page.locator('button:has-text("Submit Application")'),
    page.locator('button:has-text("Send Application")'),
    page.locator('button:has-text("Send application")'),
    page.locator('button:has-text("Submit my application")'),
    page.locator('button:has-text("Submit your application")'),
    page.locator('button:has-text("Complete application")'),
    page.locator('button:has-text("Apply for this")'),
    page.locator('button:has-text("Submit")'),
    page.locator('.submit-button'),
    page.locator('.application-form__submit'), // Lever
    page.locator('#submit_app'), // Greenhouse
    page.locator('[role="button"]:has-text("Apply")'),
    page.locator('a[role="button"]:has-text("Apply")'),
    page.locator('a:has-text("Submit")')
  ];
  return firstVisible(candidates);
}

async function findContinueControl(page) {
  const candidates = [
    page.getByRole('button', { name: /^continue$|^next$|^next\s*step$|^proceed$|^go\s*to\s*next|continue\s*→|continue\s*>/i }),
    page.locator('button:has-text("Continue")'),
    page.locator('button:has-text("Next")'),
    page.locator('button:has-text("Proceed")'),
    page.locator('button:has-text("Next Step")'),
    page.locator('button:has-text("Go Next")'),
    page.locator('[role="button"]:has-text("Continue")'),
    page.locator('[role="button"]:has-text("Next")')
  ];
  return firstVisible(candidates);
}

async function findAnySubmitControl(page) {
  return (await findFinalSubmitControl(page)) || (await findContinueControl(page));
}

async function findSkipControl(page) {
  const candidates = [
    page.getByRole('button', { name: /^skip$|^skip\s*step$|^skip\s*this|^skip\s*for\s*now|^not\s*now$/i }),
    page.locator('button:has-text("Skip")'),
    page.locator('a:has-text("Skip")'),
    page.locator('[role="button"]:has-text("Skip")'),
    page.locator('button:has-text("Skip for now")'),
    page.locator('button:has-text("Not now")')
  ];
  return firstVisible(candidates);
}

async function findLastResortButton(page) {
  // Find any visible, enabled button that's not a navigation/back/cancel button
  const candidates = [
    page.locator('button:not([disabled]):not(:has-text("Cancel")):not(:has-text("Back")):not(:has-text("Close"))').last(),
    page.locator('input[type="submit"]:not([disabled])').last(),
    page.locator('[type="submit"]:not([disabled])').last()
  ];
  for (const c of candidates) {
    try {
      if (await c.isVisible({ timeout: 1000 })) return c;
    } catch { /* ignore */ }
  }
  return null;
}

async function waitForStepTransition(page, beforeFormHtml) {
  const MAX_WAIT_MS = 30000;
  const POLL_MS = 1500;
  const startTime = Date.now();

  // Phase 1: wait for any loading/disabled state on Continue button to clear
  await page
    .locator('button[disabled], button[aria-busy="true"], button:has(.spinner), button:has([class*="spin" i]), button:has(svg[class*="animate" i])')
    .first()
    .waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => {});

  // Phase 2: poll until form DOM actually changes or timeout
  while (Date.now() - startTime < MAX_WAIT_MS) {
    const currentHtml = await page.locator('form, [role="form"], main').first()
      .innerHTML({ timeout: 3000 }).catch(() => '');

    if (beforeFormHtml && currentHtml && currentHtml !== beforeFormHtml) {
      // Form content changed — transition succeeded
      await page.waitForTimeout(500);
      return { transitioned: true };
    }

    // Also check if URL changed (some forms navigate to a new page)
    const url = page.url();
    if (/thank|confirm|success|submitted|complete|applications/i.test(url)) {
      return { transitioned: true };
    }

    await page.waitForTimeout(POLL_MS);
  }

  // Timeout: form didn't change
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { transitioned: false };
}

async function navigateMultiStepForm(page, config, coverLetterText, applicationAnswers, job, debug) {
  const MAX_STEPS = 10;
  let stuckCount = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    // Detect truly submitted applications (strict check — NOT partial/started)
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    if (/your application has been submitted|application was successfully submitted|you have already submitted this application/i.test(bodyText)) {
      return { ok: false, alreadyApplied: true, reason: 'Application was already fully submitted.' };
    }

    // Fill all fields visible at this step
    await fillPersonalDetails(page, config);
    await fillEmail(page, config.applicantEmail, config);
    await uploadResume(page, config.resumePath, config, step);
    await fillCoverLetter(page, coverLetterText, config);
    await fillKnownQuestionAnswers(page, applicationAnswers, config, job);
    await fillSelectDropdowns(page, applicationAnswers, config, job);
    await saveDebugArtifacts(page, debug, `step-${step}-filled`);

    // Safety net: fill any still-empty required fields with the general answer
    await fillRequiredEmptyFields(page, applicationAnswers, config, job);

    // Solve CAPTCHA if it appeared at this step
    if (await hasCaptcha(page)) {
      const captchaResult = await waitForCaptchaSolve(page, config, job, debug);
      if (!captchaResult.ok) {
        return { ok: false, captchaBlocked: true, reason: captchaResult.reason };
      }
    }

    // Check for final submit button first
    const submitBtn = await findFinalSubmitControl(page);
    if (submitBtn) return { ok: true, submitControl: submitBtn };

    // Check if this is a skippable step (e.g. "Additional Details") — skip before trying to fill/continue
    const stepHeading = await page.locator('h1, h2, h3, [class*="heading" i], [class*="title" i]').first().innerText({ timeout: 2000 }).catch(() => '');
    const isSkippable = /additional\s*details|optional\s*info|additional\s*information|extra\s*details|optional\s*step|supplemental/i.test(stepHeading);
    if (isSkippable) {
      const skipBtn = await findSkipControl(page);
      if (skipBtn) {
        console.log(`[MultiStepForm] Step ${step}: skipping optional step "${stepHeading.trim().slice(0, 60)}".`);
        await retryClick(page, skipBtn, 3);
        await waitForStepTransition(page, '');
        continue;
      }
    }

    // No final submit — look for Continue/Next to advance to next step
    const continueBtn = await findContinueControl(page);
    if (continueBtn) {
      // Capture form state before click for transition detection
      const beforeHtml = await page.locator('form, [role="form"], main').first()
        .innerHTML({ timeout: 3000 }).catch(() => '');

      console.log(`[MultiStepForm] Step ${step}: clicking Continue/Next to advance.`);
      const clicked = await retryClick(page, continueBtn, 3);
      if (!clicked) return { ok: false, reason: `Could not click Continue at step ${step}.` };

      const transition = await waitForStepTransition(page, beforeHtml);
      if (!transition.transitioned) {
        stuckCount += 1;
        console.warn(`[MultiStepForm] Step ${step}: form did not transition (attempt ${stuckCount}).`);
        // Check for inline validation errors
        const errorText = await page.locator('.error, [class*="error" i], [class*="invalid" i], [aria-invalid="true"]')
          .first().innerText({ timeout: 2000 }).catch(() => '');
        if (errorText) {
          console.warn(`[MultiStepForm] Validation error: ${errorText.slice(0, 200)}`);
        }
        if (stuckCount >= 3) {
          await saveDebugArtifacts(page, debug, `step-${step}-stuck`);
          return { ok: false, reason: `Form stuck after ${stuckCount} attempts at step ${step}. ${errorText ? 'Error: ' + errorText.slice(0, 200) : 'No visible error.'}` };
        }
        // Retry from the same step — re-fill and re-click
        step -= 1;
      } else {
        stuckCount = 0; // Reset on successful transition
      }
    } else {
      // Fallback: wait for page to settle then try broader button scan
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const anyBtn = await findAnySubmitControl(page);
      if (anyBtn) return { ok: true, submitControl: anyBtn };

      // Last resort: find ANY visible button on the page
      const lastResortBtn = await findLastResortButton(page);
      if (lastResortBtn) return { ok: true, submitControl: lastResortBtn };

      // No button found — send to manual review
      await saveDebugArtifacts(page, debug, `step-${step}-no-controls`);
      return { ok: false, manualReview: true, reason: `No navigation button found at step ${step}. Page may require manual application.` };
    }
  }

  return { ok: false, reason: 'Multi-step form exceeded maximum steps.' };
}

async function fillRequiredEmptyFields(page, applicationAnswers, config, job) {
  // Find required fields AND visible textareas (BruntWork often omits required attr)
  const requiredFields = page.locator(
    'textarea[required], input[required]:not([type="file"]):not([type="email"]):not([type="tel"]):not([type="number"]), textarea:visible'
  );
  const count = await requiredFields.count().catch(() => 0);
  if (count === 0) return;

  const fallback =
    applicationAnswers?.general ||
    applicationAnswers?.describe_experience ||
    applicationAnswers?.relevant_skills ||
    '';

  for (let i = 0; i < count; i++) {
    const field = requiredFields.nth(i);
    const fieldNameAttr = await field.getAttribute('name').catch(() => '');
    const fieldIdAttr = await field.getAttribute('id').catch(() => '');
    if (/g-recaptcha|h-captcha|captcha.?response/i.test(`${fieldNameAttr} ${fieldIdAttr}`)) continue;
    if (!(await field.isVisible().catch(() => false))) continue;
    if (await field.isDisabled().catch(() => false)) continue;
    const val = await field.inputValue().catch(() => '');
    if (compactText(val)) continue;
    const meta = await fieldMeta(field);
    if (shouldSkipNarrativeField(meta)) continue;
    // Try AI-generated answer (with retry), then template, then generic fallback
    let answer = await generateAiAnswer(meta.prompt, job, config);
    if (!answer) {
      // Retry once with a simpler prompt
      await page.waitForTimeout(1000);
      answer = await generateAiAnswer(meta.prompt, job, config);
    }
    if (!answer) answer = answerForPrompt(meta.prompt, applicationAnswers, config);
    if (!answer && fallback) answer = fallback;
    if (!answer) {
      answer = buildGroundedFallbackAnswer(meta.prompt, applicationAnswers, config, config.cvData);
    }
    const validated = validateApplicationAnswer({
      question: meta.prompt,
      answer,
      config,
      candidate: config.cvData,
      fallback: buildGroundedFallbackAnswer(meta.prompt, applicationAnswers, config, config.cvData)
    });
    await field.fill(sanitizeFormText(validated.answer.slice(0, meta.maxLength > 0 ? meta.maxLength : 2000)));
    console.log(`[FormFill] Filled empty required field #${i}: "${meta.prompt?.slice(0, 50)}..."`);
    await humanDelay(config);
  }
}

async function fillSelectDropdowns(page, applicationAnswers, config, job) {
  // Handle native <select> dropdowns
  const selects = page.locator('select:visible');
  const selectCount = await selects.count().catch(() => 0);
  for (let i = 0; i < selectCount; i++) {
    const sel = selects.nth(i);
    if (!(await sel.isVisible().catch(() => false))) continue;
    if (await sel.isDisabled().catch(() => false)) continue;
    const currentVal = await sel.inputValue().catch(() => '');
    if (currentVal && currentVal !== '' && currentVal !== '0') continue;

    const labelText = await sel.evaluate((el) => {
      const id = el.getAttribute('id');
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return (label?.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || '').toLowerCase();
    }).catch(() => '');

    // Get all available options
    const options = await sel.evaluate((el) => Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() })).filter(o => o.value)).catch(() => []);
    if (options.length === 0) continue;

    let chosen = null;

    // Availability / start date
    if (/availab|start|notice|when can you/i.test(labelText)) {
      chosen = options.find(o => /immediate|asap|right away|2 weeks|two weeks/i.test(o.text));
    }
    // Years of experience
    else if (/year.*exp|experience.*year|how long|how many year/i.test(labelText)) {
      chosen = options.find(o => /^[12]\b|1-2|0-2|less than|entry|under/i.test(o.text)) || options[1];
    }
    // Timezone / location
    else if (/timezone|time zone|region|location/i.test(labelText)) {
      chosen = options.find(o => /eastern|est|utc.?[+-]?[45]/i.test(o.text)) || options.find(o => /us|america|utc/i.test(o.text));
    }
    // Hours per week / availability type
    else if (/hours|part.?time|full.?time|contract/i.test(labelText)) {
      chosen = options.find(o => /full.?time|40/i.test(o.text)) || options.find(o => /part.?time|20/i.test(o.text));
    }
    // How did you hear
    else if (/hear|source|referral|found|discover/i.test(labelText)) {
      chosen = options.find(o => /job board|online|internet|website|search/i.test(o.text)) || options[1];
    }
    // Generic: pick first non-empty option
    else {
      chosen = options[0];
    }

    if (chosen) {
      await sel.selectOption({ value: chosen.value }).catch(() => {});
      console.log(`[FormFill] Select "${labelText.slice(0, 40)}" → "${chosen.text}"`);
      await humanDelay(config);
    }
  }

  // Handle radio button groups — select first visible option that looks positive
  const radioGroups = await page.evaluate(() => {
    const seen = new Set();
    const groups = [];
    document.querySelectorAll('input[type="radio"]:not([disabled])').forEach(r => {
      if (!r.name || seen.has(r.name)) return;
      seen.add(r.name);
      const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(r.name)}"]`));
      const checked = radios.some(x => x.checked);
      if (!checked) {
        const labelEl = r.closest('label') || document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
        groups.push({ name: r.name, labelText: labelEl?.textContent?.trim() || '', firstValue: radios[0]?.value });
      }
    });
    return groups;
  }).catch(() => []);

  for (const group of radioGroups) {
    const lbl = group.labelText.toLowerCase();
    // "Yes/No" questions — prefer Yes for availability/authorization type questions
    const yesOption = page.locator(`input[type="radio"][name="${group.name}"]`).filter({ hasText: /yes|true|agree/i });
    const firstOption = page.locator(`input[type="radio"][name="${group.name}"]`).first();
    if (/available|authorized|authorize|right to work|eligible|can you|willing|agree/i.test(lbl)) {
      const yesCount = await yesOption.count().catch(() => 0);
      if (yesCount > 0) { await yesOption.first().check().catch(() => {}); continue; }
    }
    await firstOption.check().catch(() => {});
    console.log(`[FormFill] Radio "${group.name}" → first option selected`);
    await humanDelay(config);
  }
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        return item;
      }
    }
  }
  return null;
}

async function retryClick(page, locator, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await locator.waitFor({ state: 'visible', timeout: 5000 });
      await locator.click({ timeout: 10000 });
      return true;
    } catch {
      await page.waitForTimeout(1000 * attempt).catch(() => {});
    }
  }
  return false;
}

async function waitForPostSubmitSettling(page) {
  // Wait for URL change or quick settle — don't wait long for confirmation page
  await Promise.race([
    page.waitForURL((url) => /thank|confirm|success|submitted|complete|applications/i.test(url.toString()), { timeout: 8000 }).catch(() => {}),
    page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}),
    page.waitForTimeout(8000)
  ]);
  await page.waitForTimeout(1000);
}

async function validateAutoApplyConfig(config) {
  if (!config.applicantEmail) return { ok: false, reason: 'Missing APPLICANT_EMAIL.' };
  if (config.resumePlaceholder) {
    return {
      ok: false,
      reason: `Profile ${config.profileName} uses a placeholder resume. Replace ${config.resumePath} before auto-apply.`
    };
  }
  try {
    await fs.access(config.resumePath);
  } catch {
    return { ok: false, reason: `Resume not found at ${config.resumePath}.` };
  }
  return { ok: true };
}

async function inspectFormSafety(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  if (isBotProtectionText(bodyText)) {
    return {
      ok: false,
      manualReview: true,
      reason: 'Bot protection page detected before the application form. Open this job manually or run non-headless.'
    };
  }

  if (await hasCaptcha(page)) {
    return { ok: false, captcha: true, reason: 'CAPTCHA detected. Waiting for manual intervention.' };
  }

  const currentUrl = page.url();
  // Well-known ATS platforms handle complex forms natively — skip field count gate
  if (isKnownAtsUrl(currentUrl)) {
    return { ok: true };
  }

  // Raised from 8 to 20 — external ATS forms routinely have 10–15 required fields
  const requiredFields = await page.locator('input[required], textarea[required], select[required]').count();
  if (requiredFields > 20) {
    return { ok: false, reason: `Very complex form detected (${requiredFields} required fields). Manual review required.` };
  }

  return { ok: true };
}

/**
 * Returns true when the URL belongs to a well-known external ATS platform.
 * Used to skip the required-fields safety gate and to guide form filling.
 */
function isKnownAtsUrl(url) {
  return [
    'jobs.lever.co',
    'boards.greenhouse.io', 'job-boards.greenhouse.io',
    'apply.workable.com',
    'jobs.ashbyhq.com', 'app.ashbyhq.com',
    'app.bamboohr.com',
    'jobs.smartrecruiters.com',
    'elblearning.na.teamtailor.com', '.teamtailor.com',
    'jobs.personio.de', '.jobs.personio.de',
    'recruiting.ultipro.com',
    'careers.icims.com',
    'myworkdayjobs.com',
    'recruitee.com',
    'app.jobvite.com',
    'jazz.co', 'app.jazz.co'
  ].some((domain) => url.includes(domain));
}

/**
 * Detect which ATS platform the current page belongs to.
 * Returns a string key or null.
 */
function detectAtsPlatform(url) {
  if (url.includes('jobs.lever.co')) return 'lever';
  if (url.includes('boards.greenhouse.io') || url.includes('job-boards.greenhouse.io')) return 'greenhouse';
  if (url.includes('apply.workable.com')) return 'workable';
  if (url.includes('jobs.ashbyhq.com') || url.includes('app.ashbyhq.com')) return 'ashby';
  if (url.includes('app.bamboohr.com')) return 'bamboohr';
  if (url.includes('jobs.smartrecruiters.com')) return 'smartrecruiters';
  if (url.includes('.teamtailor.com')) return 'teamtailor';
  if (url.includes('jobs.personio.de') || url.includes('.jobs.personio.de')) return 'personio';
  if (url.includes('recruiting.ultipro.com')) return 'ultipro';
  if (url.includes('careers.icims.com')) return 'icims';
  if (url.includes('myworkdayjobs.com')) return 'workday';
  if (url.includes('recruitee.com')) return 'recruitee';
  return null;
}

function isBotProtectionText(text) {
  return /performing security verification|security service to protect against malicious bots|checking if the site connection is secure|just a moment|cloudflare/i.test(
    String(text || '')
  );
}

async function hasCaptcha(page) {
  // First check if CAPTCHA is already solved (token present) — no need to solve again
  if (await hasRecaptchaToken(page)) return false;

  // Check for reCAPTCHA/hCaptcha iframes (visible OR attached — BruntWork renders in non-scrollable area)
  const frames = page.locator(
    'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"], iframe[src*="hcaptcha.com/captcha"], iframe[title*="recaptcha challenge" i]'
  );
  const frameCount = await frames.count().catch(() => 0);
  if (frameCount > 0) return true;

  // Check for data-sitekey elements (the reCAPTCHA widget container)
  const captchaEls = page.locator('.g-recaptcha[data-sitekey], .h-captcha[data-sitekey], [data-sitekey]:not(script)');
  const elCount = await captchaEls.count().catch(() => 0);
  if (elCount > 0) return true;

  // Check for reCAPTCHA response textarea (present when widget is rendered but token is empty)
  const responseField = await page.locator('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]').count().catch(() => 0);
  if (responseField > 0) return true;

  const textCount = await page.getByText(/verify you are human|not a robot/i).count().catch(() => 0);
  return textCount > 0;
}

async function waitForCaptchaSolve(page, config, job, debug) {
  await saveDebugArtifacts(page, debug, 'captcha_waiting');
  const captchaWaitMs = config.headless
    ? Math.min(config.captchaWaitMs || 0, 45000)
    : config.captchaWaitMs;

  // Detect CAPTCHA error type — NEVER reload (reloading clears the filled form!)
  const errorType = await detectCaptchaError(page);
  if (errorType === 'rate_limited') {
    console.warn('[CaptchaSolver] Google rate limit ("Try again later"). Waiting 90s for it to clear...');
    await page.waitForTimeout(90000);
  } else if (errorType === 'connection') {
    console.warn('[CaptchaSolver] reCAPTCHA connection error. Waiting 30s...');
    await page.waitForTimeout(30000);
  }

  // Add human-like delay before interacting with CAPTCHA
  await page.waitForTimeout(2000 + Math.floor(Math.random() * 3000));

  // Attempt automated solve via configured provider.
  if (config.captchaSolvApiKey || process.env.CAPTCHASOLV_API_KEY || config.capsolverApiKey || process.env.CAPSOLVER_API_KEY) {
    const autoResult = await solveCaptchaAuto(page, config);
    if (autoResult.ok) {
      await sendNotification(`CAPTCHA auto-solved for ${job.title}. Resuming automation.`, config);
      return { ok: true, reason: autoResult.reason };
    }
    // If Google rate-limited us, don't wait for impossible manual solve - skip the job
    if (/try again later|rate.?limit/i.test(autoResult.reason || '')) {
      console.warn('[CaptchaSolver] Google rate limit hit. Skipping job to cool down.');
      return { ok: false, reason: 'Google rate-limited. Will retry job later.', rateLimited: true };
    }
    console.warn(`[CaptchaSolver] Auto-solve failed: ${autoResult.reason}.`);
    if (config.headless) {
      console.warn('[CaptchaSolver] Headless mode — manual solve impossible. Skipping job for retry later.');
      return { ok: false, reason: `CAPTCHA auto-solve failed (headless). ${autoResult.reason}` };
    }
    console.warn('[CaptchaSolver] Falling back to manual.');
  }

  // Manual fallback: notify user and wait (only reached in non-headless mode)
  await sendNotification(`CAPTCHA detected for ${job.title}. Please solve it in the browser; automation will resume.`, config);
  const start = Date.now();
  let lastScreenshotAt = 0;

  while (Date.now() - start < captchaWaitMs) {
    // Throttle screenshots to once per 60s
    if (Date.now() - lastScreenshotAt > 60000) {
      await saveDebugArtifacts(page, debug, 'captcha_waiting');
      lastScreenshotAt = Date.now();
    }
    await page.waitForTimeout(5000);

    // Check if CAPTCHA is truly solved (token present)
    if (await hasRecaptchaToken(page)) {
      await sendNotification(`CAPTCHA cleared for ${job.title}. Resuming automation.`, config);
      return { ok: true, reason: 'CAPTCHA cleared manually.' };
    }

    // Also accept if CAPTCHA elements are completely gone (non-reCAPTCHA forms)
    if (!(await hasCaptcha(page)) && !(await hasRecaptchaWidget(page))) {
      await sendNotification(`CAPTCHA cleared for ${job.title}. Resuming automation.`, config);
      return { ok: true, reason: 'CAPTCHA cleared (no widget detected).' };
    }
  }

  // After timeout: skip this job — don't attempt submit without CAPTCHA (will fail)
  console.warn('[CaptchaSolver] CAPTCHA not solved within timeout. Skipping job.');
  return { ok: false, reason: 'CAPTCHA was not solved before timeout.' };
}

async function detectCaptchaError(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  if (/try again later|sending automated queries/i.test(bodyText)) return 'rate_limited';
  if (/could not connect to the recaptcha service/i.test(bodyText)) return 'connection';
  try {
    for (const frame of page.frames()) {
      const text = await frame.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      if (/try again later|sending automated queries/i.test(text)) return 'rate_limited';
      if (/could not connect/i.test(text)) return 'connection';
    }
  } catch {}
  return null;
}

async function hasRecaptchaToken(page) {
  // Check if the hidden g-recaptcha-response textarea has a token value
  const token = await page.locator('textarea[name="g-recaptcha-response"]').inputValue().catch(() => '');
  return token.length > 10;
}

async function hasRecaptchaWidget(page) {
  // Check if any reCAPTCHA elements exist on the page at all
  const count = await page.locator('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]').count().catch(() => 0);
  return count > 0;
}

async function hasStuckSpinner(page) {
  const spinner = page.locator('[aria-busy="true"], .spinner, .loading, [class*="loading" i], [class*="spinner" i]');
  if (!(await hasVisibleLocator(spinner))) return false;
  await page.waitForTimeout(10000);
  return hasVisibleLocator(spinner);
}

async function hasVisibleSubmitControl(page) {
  return Boolean(await findAnySubmitControl(page));
}

async function formIsMostlyDisabled(page) {
  const fields = page.locator('form input, form textarea, form select, form button');
  const total = await fields.count().catch(() => 0);
  if (total === 0) return false;

  let disabled = 0;
  for (let index = 0; index < total; index += 1) {
    const field = fields.nth(index);
    if (await field.isDisabled().catch(() => false)) disabled += 1;
  }
  return disabled / total >= 0.6;
}

async function hasApplicationFields(page) {
  // Only match fields that look like actual application forms, not site-wide search/nav inputs
  const applicationFields = page.locator([
    'input[type="email"]:not([role="search"])',
    'input[type="file"]',
    'textarea:not([id*="search"]):not([name*="search"])',
    'form input[name*="name" i]',
    'form input[name*="email" i]',
    'form input[name*="phone" i]',
    'form input[name*="resume" i]',
    'form input[name*="cover" i]',
    'form select[name*="country" i]'
  ].join(', '));
  return (await applicationFields.count().catch(() => 0)) >= 2;
}

async function hasVisibleLocator(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function fillPersonalDetails(page, config) {
  const cv = config.cvData;
  if (!cv) return;

  const fill = async (locatorCss, value) => {
    if (!value) return;
    const field = page.locator(locatorCss).first();
    if (!(await field.isVisible().catch(() => false))) return;
    if (await field.isDisabled().catch(() => false)) return;
    const current = await field.inputValue().catch(() => '');
    if (current) return;
    await field.fill(String(value)).catch(() => {});
    await humanDelay(config);
  };

  // Full name
  if (cv.name) {
    await fill('input[name*="full" i][name*="name" i], input[id*="full" i][id*="name" i], input[placeholder*="full name" i]', cv.name);
    const nameParts = cv.name.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      await fill('input[name*="first" i], input[id*="first" i], input[placeholder*="first name" i]', nameParts[0]);
      await fill('input[name*="last" i], input[id*="last" i], input[placeholder*="last name" i]', nameParts.slice(1).join(' '));
    }
  }

  // Phone
  if (cv.phone) {
    await fill('input[type="tel"], input[name*="phone" i], input[id*="phone" i], input[placeholder*="phone" i], input[name*="mobile" i], input[id*="mobile" i]', cv.phone);
  }

  // Location / city
  if (cv.location) {
    await fill('input[name*="city" i], input[id*="city" i], input[placeholder*="city" i]', cv.location.split(',')[0].trim());
    await fill('input[name*="location" i], input[id*="location" i], input[placeholder*="location" i]', cv.location);
  }

  // LinkedIn
  if (cv.linkedin) {
    await fill('input[name*="linkedin" i], input[id*="linkedin" i], input[placeholder*="linkedin" i]', cv.linkedin);
  }

  // GitHub
  if (cv.github) {
    await fill('input[name*="github" i], input[id*="github" i], input[placeholder*="github" i]', cv.github);
  }

  // Website / portfolio
  if (cv.website) {
    await fill('input[name*="website" i], input[id*="website" i], input[placeholder*="website" i], input[name*="portfolio" i], input[id*="portfolio" i]', cv.website);
  }
}

async function fillEmail(page, email, config) {
  const emailFields = page.locator('input[type="email"]:not([id*="report" i]):not([id*="dead-link" i]), input[name*="email" i]:not([id*="report" i]):not([id*="dead-link" i]), input[id*="email" i]:not([id*="report" i]):not([id*="dead-link" i])');
  const count = await emailFields.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const field = emailFields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    if (await field.isDisabled().catch(() => false)) continue;
    const current = await field.inputValue().catch(() => '');
    if (current) return;
    try {
      await field.fill(email, { timeout: 5000 });
      await humanDelay(config);
      return;
    } catch { continue; }
  }
}

async function uploadResume(page, resumePath, config, step = 1) {
  if (!resumePath) return;

  // Wait briefly for React to render file input after step transition
  await page.waitForTimeout(1000);

  // Strategy 1: Standard file input (visible or hidden — BruntWork wraps it in a <label>)
  const fileInput = page.locator('input[type="file"]').first();
  if ((await fileInput.count()) > 0) {
    try {
      await fileInput.setInputFiles(resumePath);
      console.log('[Upload] Resume uploaded via file input.');
      await page.waitForTimeout(2000); // Wait for upload processing
      return;
    } catch (e) {
      console.warn(`[Upload] File input setInputFiles failed: ${e.message}`);
    }
  }

  // Strategy 2: Click the dropzone label to trigger filechooser
  const dropzone = page.locator('label:has(input[type="file"]), [class*="dropzone" i], [class*="file-drop" i]').first();
  if ((await dropzone.count()) > 0) {
    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        dropzone.click()
      ]);
      await fileChooser.setFiles(resumePath);
      console.log('[Upload] Resume uploaded via dropzone filechooser.');
      await page.waitForTimeout(2000);
      return;
    } catch (e) {
      console.warn(`[Upload] Dropzone filechooser failed: ${e.message}`);
    }
  }

  // Step 1 never has a file input — suppress the warning there
  if (step > 1) {
    console.warn('[Upload] No file input found on page — resume upload skipped.');
  }
}

async function fillCoverLetter(page, coverLetter, config) {
  if (!coverLetter) return;
  const cleaned = sanitizeFormText(coverLetter);
  const coverLetterField = page.locator(
    'textarea[name*="cover" i], textarea[id*="cover" i], textarea[placeholder*="cover" i], textarea[name*="message" i], textarea[id*="message" i], textarea[placeholder*="message" i]'
  );

  if (await hasVisibleLocator(coverLetterField)) {
    await fillFirstEmptyVisible(coverLetterField, cleaned);
    await humanDelay(config);
    return;
  }

  const textareas = page.locator('textarea:visible:not([name*="recaptcha" i]):not([id*="recaptcha" i]):not([class*="recaptcha" i])');
  if ((await textareas.count().catch(() => 0)) === 1) {
    const coverLetterField = textareas.first();
    await coverLetterField.fill(cleaned);
    await humanDelay(config);
  }
}

// Cache AI answers per session to avoid duplicate API calls for same questions
const aiAnswerCache = new Map();

async function generateAiAnswer(questionPrompt, job, config) {
  const cleanQuestion = (questionPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!cleanQuestion || cleanQuestion.length < 10) return null;

  // Skip non-question fields (names, emails, numbers)
  if (/^(name|first|last|email|phone|city|country|salary|rate|url|link|http)/i.test(cleanQuestion)) return null;

  // Video/voice/audio recording requests — skip, leave empty (these are optional on BruntWork)
  if (/loom|vocaroo|voice.*(sample|recording)|video.*(sample|recording|intro|yourself)|audio.*(sample|recording)|record.*(yourself|video|audio)|loom.*link|video.*link/i.test(cleanQuestion)) {
    return null;
  }

  const groqKey = config.groqApiKey || process.env.GROQ_API_KEY;
  const geminiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  const openRouterKey = config.openRouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!groqKey && !geminiKey && !openRouterKey) return null;

  const cacheKey = `${job?.title || ''}|${cleanQuestion}`;
  if (aiAnswerCache.has(cacheKey)) return aiAnswerCache.get(cacheKey);

  const candidateName = config.candidateProfile?.name || 'the candidate';
  const jobTitle = job?.title || 'this role';
  const resumePreview = [
    config.candidateProfile?.resumeTextPreview || '',
    config.cvData?.rawTextPreview || '',
    config.cvData?.summary || ''
  ].filter(Boolean).join(' ').slice(0, 900);
  const skills = [
    ...(config.candidateProfile?.skills || []),
    ...(config.cvData?.skills || [])
  ].join(', ');

  const systemPrompt = `You are a human job applicant answering a question on an application form. Your name is ${candidateName}. 
Write a direct, honest, concise answer (1-3 sentences max).
The answer MUST specifically address what the question is asking about.
Use the candidate's real skills and experience from their resume. Do NOT make up skills they don't have.
If the question asks "do you have X skill" and the candidate doesn't have it, simply state the transferable skills you have instead.
CRITICAL RULES:
- NEVER use markdown, bullet points, asterisks, or dashes. 
- NEVER use phrases like "As an AI", "As a language model", "Here is my answer", or "Based on my resume".
- Output ONLY the raw text answer. No introductory or concluding remarks.`;

  const userPrompt = `Job: ${jobTitle}
Candidate skills: ${skills}
Resume summary: ${resumePreview.slice(0, 500)}

Question on the application form: "${cleanQuestion}"

Write a concise, specific answer (1-3 sentences):`;

  // Try Groq first, then Gemini, then OpenRouter
  const providers = [];
  if (groqKey) providers.push({ url: 'https://api.groq.com/openai/v1/chat/completions', key: groqKey, model: 'llama-3.3-70b-versatile' });
  if (geminiKey) providers.push({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: geminiKey, model: 'gemini-2.5-flash-lite' });
  if (openRouterKey) providers.push({ url: 'https://openrouter.ai/api/v1/chat/completions', key: openRouterKey, model: 'nvidia/nemotron-3-super-120b-a12b:free' });

  for (const provider of providers) {
    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.key}`
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 150
        })
      });

      if (!res.ok) {
        console.warn(`[AI-Answer] ${provider.model} error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const answer = cleanApplicationAnswer(data.choices?.[0]?.message?.content || '');
      const validated = validateApplicationAnswer({
        question: cleanQuestion,
        answer,
        config,
        candidate: config.cvData,
        fallback: buildGroundedFallbackAnswer(cleanQuestion, {}, config, config.cvData)
      });
      
      if (validated.answer && validated.answer.length > 15) {
        if (!validated.ok) {
          console.warn(`[AI-Answer] Replaced unsupported answer claim for "${cleanQuestion.slice(0, 50)}...": ${validated.reason}`);
        } else {
        console.log(`[AI-Answer] Generated for "${cleanQuestion.slice(0, 50)}..." → ${answer.slice(0, 60)}...`);
        }
        aiAnswerCache.set(cacheKey, validated.answer);
        return validated.answer;
      }
    } catch (err) {
      console.warn(`[AI-Answer] ${provider.model} exception: ${err.message}`);
    }
  }

  return null;
}

async function fillKnownQuestionAnswers(page, applicationAnswers, config, job) {
  if (!applicationAnswers || Object.keys(applicationAnswers).length === 0) return;

  const fields = page.locator('textarea, input[type="text"], input:not([type])');
  const count = await fields.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    const fieldNameAttr = await field.getAttribute('name').catch(() => '');
    const fieldIdAttr = await field.getAttribute('id').catch(() => '');
    if (/g-recaptcha|h-captcha|captcha.?response/i.test(`${fieldNameAttr} ${fieldIdAttr}`)) continue;
    if (!(await field.isVisible().catch(() => false))) continue;
    if (await field.isDisabled().catch(() => false)) continue;

    const currentValue = await field.inputValue().catch(() => '');
    if (compactText(currentValue)) continue;

    const meta = await fieldMeta(field);
    if (shouldSkipNarrativeField(meta)) continue;

    // Try AI-generated answer first, fall back to template
    let answer = await generateAiAnswer(meta.prompt, job, config);
    if (!answer) {
      answer = answerForPrompt(meta.prompt, applicationAnswers, config);
    }
    if (answer) {
      await field.fill(limitAnswerForField(answer, meta));
      await humanDelay(config);
    }
  }
}

async function fillFirstEmptyVisible(locator, value) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const currentValue = await item.inputValue().catch(() => '');
    if (compactText(currentValue)) continue;
    await item.fill(value);
    return true;
  }
  return false;
}

async function fieldMeta(locator) {
  return locator
    .evaluate((element) => {
      const id = element.getAttribute('id');
      const label = id && window.CSS?.escape ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const container = element.closest('label, .form-group, .field, .question, .application-question, li, div');
      const pieces = [
        label?.textContent,
        element.closest('label')?.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.getAttribute('name'),
        element.getAttribute('id'),
        container?.textContent
      ].filter(Boolean);

      return {
        prompt: pieces.join(' ').slice(0, 800),
        name: element.getAttribute('name') || '',
        id: element.getAttribute('id') || '',
        placeholder: element.getAttribute('placeholder') || '',
        type: element.getAttribute('type') || element.tagName.toLowerCase(),
        maxLength: Number.parseInt(element.getAttribute('maxlength') || '0', 10)
      };
    })
    .catch(() => ({ prompt: '', name: '', id: '', placeholder: '', type: '', maxLength: 0 }));
}

function answerForPrompt(prompt, applicationAnswers, config = {}) {
  const normalizedPrompt = String(prompt || '').toLowerCase();
  if (!normalizedPrompt) return '';

  if (/why.*(fit|qualified)|good fit|best fit|suitable|hire you/.test(normalizedPrompt)) {
    return applicationAnswers.why_good_fit || applicationAnswers.general || '';
  }
  if (/experience|background|describe|tell us about|previous work|work history|coordinating|coordinate/.test(normalizedPrompt)) {
    return applicationAnswers.describe_experience || applicationAnswers.general || '';
  }
  if (/why.*(role|job|position|company)|interest|motivated|want this/.test(normalizedPrompt)) {
    return applicationAnswers.why_this_role || applicationAnswers.general || '';
  }
  if (/skill|strength|qualification|expertise|managed|management|manage|systems|tools|software|platform|technology|proficient|knowledge/.test(normalizedPrompt)) {
    return applicationAnswers.relevant_skills || applicationAnswers.general || '';
  }
  if (/remote|work from home|independent|timezone|communication/.test(normalizedPrompt)) {
    return applicationAnswers.remote_work || applicationAnswers.general || '';
  }
  if (/cover letter|message|additional information|anything else/.test(normalizedPrompt)) {
    return applicationAnswers.general || '';
  }

  // Catch "do you have / have you / are you / can you" yes/no style questions
  if (/\b(do you have|have you|are you|can you|could you|would you|did you)\b/.test(normalizedPrompt)) {
    return buildGroundedFallbackAnswer(prompt, applicationAnswers, config, config.cvData);
  }

  // General fallback: any question-style prompt (how/which/what/why/explain/share/provide)
  if (/\b(which|how|what|explain|provide|share|list|give|outline|detail)\b/.test(normalizedPrompt)) {
    const topic = extractTopicFromPrompt(normalizedPrompt);
    const base = applicationAnswers.general || applicationAnswers.describe_experience || applicationAnswers.relevant_skills || '';
    if (topic && base) {
      return `Regarding ${topic}: ${base}`;
    }
    return base;
  }

  // Last resort: if it looks like a question field, always answer
  if (normalizedPrompt.includes('?') || normalizedPrompt.length > 20) {
    return buildGroundedFallbackAnswer(prompt, applicationAnswers, config, config.cvData);
  }

  return '';
}

function extractTopicFromPrompt(prompt) {
  // Remove question framing words to extract the topic
  return prompt
    .replace(/\b(do you have|have you|are you|can you|could you|would you|did you|how much|how many|what is your|what are your|please describe|tell us about)\b/gi, '')
    .replace(/[?.,!]+/g, '')
    .replace(/\b(any|some|the|a|an|with|in|of|for|and|or|to|by|on|your|our|their)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '';
}

function shouldSkipNarrativeField(meta) {
  const fieldKeys = `${meta.name} ${meta.id} ${meta.placeholder}`.toLowerCase();
  const prompt = String(meta.prompt || '').toLowerCase();

  // Always skip reCAPTCHA / hCaptcha hidden response fields
  if (/g-recaptcha-response|h-captcha-response|captcha.?response/i.test(fieldKeys)) return true;

  // Fields whose name/id is clearly a personal data field (not narrative questions)
  const personalFieldKeyPattern =
    /(^|\b)(first.?name|last.?name|full.?name|phone|mobile|address|city|country|linkedin|github|portfolio|website|salary|compensation|visa|authorization|authorized|notice.?period)(\b|$)/i;
  // "email" only when it's an email INPUT field, not "email marketing" or "email support"
  const emailFieldPattern = /\bemail\b/i;
  const emailQuestionContext = /email.*(marketing|support|campaign|outreach|newsletter|management|skill|knowledge)/i;

  if (personalFieldKeyPattern.test(fieldKeys)) return true;
  if (emailFieldPattern.test(fieldKeys) && !emailQuestionContext.test(fieldKeys)) return true;

  // Known narrative question patterns — never skip these
  if (/why|fit|experience|background|skill|knowledge|cover letter|message|additional information|remote|communication|marketing|do you have|have you|are you/.test(prompt)) {
    return false;
  }

  return personalFieldKeyPattern.test(prompt) && !emailQuestionContext.test(prompt);
}

function limitAnswerForField(answer, meta) {
  const value = sanitizeFormText(String(answer || ''));
  if (meta.maxLength > 0) return value.slice(0, meta.maxLength);
  if (meta.type === 'text') return value.slice(0, 500);
  return value;
}

function sanitizeFormText(text) {
  if (!text) return text;
  return (
    text
      // Remove markdown bold and italic
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/\*(.+?)\*/gs, '$1')
      // Remove markdown headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bullet/dash list markers at line start (- item, * item, • item)
      .replace(/^\s*[-*•]\s+/gm, '')
      // Remove inline dashes used as separators (em dash, en dash surrounded by spaces)
      .replace(/\s+[\u2013\u2014-]\s+/g, ' ')
      // Collapse multiple spaces into one
      .replace(/ {2,}/g, ' ')
      // Collapse more than 2 consecutive newlines
      .replace(/\n{3,}/g, '\n\n')
      // Trim each line
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim()
  );
}

function simulateConfirmationForTestMode() {
  return manualReview('TEST_MODE simulation: submit intentionally skipped.', {
    expectedSuccessSignals: ['URL change', 'confirmation text', 'successful POST response'],
    expectedFailureSignals: ['CAPTCHA', 'validation error', 'stuck spinner', 'submit button still visible']
  });
}

function normalizeApplicationPackage(value) {
  if (typeof value === 'string') {
    return { coverLetterText: value, applicationAnswers: {} };
  }

  return {
    coverLetterText: value?.optimized_cover_letter || value?.cover_letter || value?.coverLetter || '',
    applicationAnswers: value?.improved_answers || value?.application_answers || value?.applicationAnswers || {}
  };
}

function browserArgsForMode(config) {
  const baseArgs = config.headless
    ? stealthArgs
    : stealthArgs.filter((arg) => !['--silent', '--no-startup-window'].includes(arg));
  const extras = config.headless
    ? ['--disable-gpu', '--log-level=3', '--silent-launch', '--no-startup-window']
    : ['--disable-gpu', '--log-level=3'];
  return [...baseArgs, ...extras];
}

function success(reason, details) {
  return { outcome: ApplicationOutcome.APPLIED_SUCCESSFULLY, reason, ...details };
}

function failure(reason, details) {
  return { outcome: ApplicationOutcome.APPLICATION_FAILED, reason, ...details };
}

function manualReview(reason, details) {
  return { outcome: ApplicationOutcome.REQUIRES_MANUAL_REVIEW, reason, ...details };
}

function createDebugCollector(job, config) {
  const jobHash = hashJob(job);
  const root = config.testMode && config.testResultsDir
    ? config.testResultsDir
    : config.debugRootDir || path.resolve(config.rootDir || process.cwd(), 'debug', config.profileName || 'default');
  const dir = path.join(root, jobHash);
  return {
    dir,
    jobHash,
    consoleLogs: []
  };
}

function collectConsoleLogs(page, debug) {
  page.on('console', (message) => {
    debug.consoleLogs.push(`[${new Date().toISOString()}] ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    debug.consoleLogs.push(`[${new Date().toISOString()}] pageerror: ${error.message}`);
  });
}

async function saveDebugArtifacts(page, debug, label) {
  await fs.mkdir(debug.dir, { recursive: true });
  const safeLabel = String(label || 'step').replace(/[^a-z0-9_-]+/gi, '-');
  const screenshotName = safeLabel === 'captcha_waiting' ? `${safeLabel}_${Date.now()}.png` : `screenshot_${safeLabel}.png`;
  await page.screenshot({ path: path.join(debug.dir, screenshotName), fullPage: true }).catch(() => {});

  if (safeLabel === '06-before-submit' || safeLabel === 'before_submit') {
    await page.screenshot({ path: path.join(debug.dir, 'screenshot_before_submit.png'), fullPage: true }).catch(() => {});
  }

  if (safeLabel === '07-after-submit' || safeLabel === 'after_submit') {
    await page.screenshot({ path: path.join(debug.dir, 'screenshot_after_submit.png'), fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    await fs.writeFile(path.join(debug.dir, 'page_html_after_submit.html'), html, 'utf8').catch(() => {});
  }
}

async function writeConsoleLogs(debug) {
  await fs.mkdir(debug.dir, { recursive: true });
  await fs.writeFile(path.join(debug.dir, 'console_logs.txt'), `${debug.consoleLogs.join('\n')}\n`, 'utf8').catch(() => {});
}

async function writeLifecycle(debug, lifecycle) {
  await fs.mkdir(debug.dir, { recursive: true });
  await fs.writeFile(path.join(debug.dir, 'application_lifecycle.json'), `${JSON.stringify(lifecycle, null, 2)}\n`, 'utf8').catch(() => {});
}

async function writeSimulatedAutomationArtifacts(debug, job, payload) {
  await fs.mkdir(debug.dir, { recursive: true });
  await fs.writeFile(
    path.join(debug.dir, 'page_html_after_submit.html'),
    renderSimulatedApplicationHtml(job, payload),
    'utf8'
  ).catch(() => {});
  await fs.writeFile(
    path.join(debug.dir, 'simulated_form_payload.json'),
    `${JSON.stringify(
      {
        job,
        coverLetterText: payload.coverLetterText,
        applicationAnswers: payload.applicationAnswers
      },
      null,
      2
    )}\n`,
    'utf8'
  ).catch(() => {});
  await writeLifecycle(debug, payload.lifecycle);
  await writeConsoleLogs(debug);
}

function renderSimulatedApplicationHtml(job, payload) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Simulated Application</title></head>
<body>
  <h1>${escapeHtml(job.title || 'Simulated application')}</h1>
  <p>TEST_PLATFORM_MODE=true: automation simulated a TEST_MODE form fill and did not submit.</p>
  <h2>Cover Letter</h2>
  <pre>${escapeHtml(payload.coverLetterText || '')}</pre>
  <h2>Application Answers</h2>
  <pre>${escapeHtml(JSON.stringify(payload.applicationAnswers || {}, null, 2))}</pre>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resultFromLifecycle(lifecycle, debug) {
  return {
    applied: lifecycle.outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY,
    outcome: lifecycle.outcome,
    finalState: lifecycle.currentState,
    reason: lifecycle.reason,
    lifecycle,
    debugDir: debug.dir,
    jobHash: debug.jobHash
  };
}
