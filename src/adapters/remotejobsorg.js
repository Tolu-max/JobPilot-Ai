import { FormStep, Proof, noProof } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  gatewayHandoffBlockedReason,
  recordGatewayDestination,
  shouldAllowGatewayHandoff
} from './atsResolver.js';

const NAME = 'remotejobsorg';

function matches(url) {
  return /remotejobs\.org\/remote-jobs\//i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (await page.locator('input[type="email"]').first().isVisible({ timeout: 1000 }).catch(() => false)) {
    return FormStep.EMAIL;
  }
  if (/apply for this position/i.test(body)) return FormStep.DETAILS;
  if (/thank you|application submitted|successfully submitted/i.test(body)) return FormStep.SUBMITTED;
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  if (step === FormStep.DETAILS) {
    const applyButton = page.getByRole('button', { name: /apply for this position/i }).first();
    if (await applyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applyButton.click({ force: true });
      await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }
  }

  if (step === FormStep.EMAIL || step === FormStep.DETAILS) {
    const email = ctx.config?.applicantEmail || ctx.candidate?.email || '';
    if (!email) throw new Error('[remotejobsorg.fillStep] no candidate email configured.');
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(email);
  }
}

async function advance(page, step, ctx) {
  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.EMAIL,
      advanced: false,
      reason: 'NO_REAL_SUBMISSION/TEST_MODE: RemoteJobs.org email step filled and stopped before Continue to Application.'
    };
  }

  if (step === FormStep.DETAILS) {
    await fillStep(page, FormStep.DETAILS, ctx);
  }

  if (!ctx.config?.allowGatewayAutoSubmit && !ctx.config?.allowGatewayLiveHandoff) {
    const sourceUrl = ctx.job?.applicationUrl || ctx.job?.raw?.url || page.url();
    return {
      step,
      advanced: false,
      reason: gatewayHandoffBlockedReason('RemoteJobs.org', { adapter: 'post-email destination', url: sourceUrl }, sourceUrl),
      meta: { resolvedUrl: sourceUrl, downstreamAdapter: '', reason: 'live-handoff-disabled' }
    };
  }

  const handoffProbe = classifyApplyDestination(ctx.job?.raw?.apply_url || ctx.job?.applicationUrl || ctx.job?.applyUrl || '', { source: NAME });
  await recordGatewayDestination(ctx, page, handoffProbe, handoffProbe.url, NAME);
  if (handoffProbe.supported && !shouldAllowGatewayHandoff(handoffProbe, ctx.config)) {
    return {
      step,
      advanced: false,
      reason: gatewayHandoffBlockedReason('RemoteJobs.org', handoffProbe, handoffProbe.url),
      meta: { resolvedUrl: handoffProbe.url, downstreamAdapter: handoffProbe.adapter, reason: 'live-handoff-disabled' }
    };
  }

  const continueButton = page.getByRole('button', { name: /continue to application/i }).first();
  if (!(await continueButton.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { step, advanced: false, reason: 'RemoteJobs.org Continue to Application button was not visible.' };
  }

  const beforeUrl = page.url();
  const applyUrlPromise = waitForTrackedApplyUrl(page);
  await continueButton.click({ force: true });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  const trackedApplyUrl = await applyUrlPromise || await extractEmbeddedApplyUrl(page);
  if (trackedApplyUrl) {
    const classification = classifyApplyDestination(trackedApplyUrl, { source: NAME });
    await recordGatewayDestination(ctx, page, classification, trackedApplyUrl, NAME);
    if (!classification.supported) {
      return {
        step,
        advanced: false,
        reason: `RemoteJobs.org resolved to unsupported/manual destination (${classification.reason}): ${trackedApplyUrl}`,
        meta: { resolvedUrl: trackedApplyUrl, downstreamAdapter: classification.adapter, reason: classification.reason }
      };
    }
    if (!shouldAllowGatewayHandoff(classification, ctx.config)) {
      return {
        step,
        advanced: false,
        reason: gatewayHandoffBlockedReason('RemoteJobs.org', classification, trackedApplyUrl),
        meta: { resolvedUrl: trackedApplyUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
      };
    }
    await page.goto(trackedApplyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    await page.waitForTimeout(5000);
  }

  const afterUrl = page.url();
  const classification = classifyApplyDestination(afterUrl, { source: NAME });
  await recordGatewayDestination(ctx, page, classification, afterUrl, NAME);
  if (afterUrl !== beforeUrl && classification.supported) {
    return {
      step: FormStep.DETAILS,
      advanced: true,
      reason: `RemoteJobs.org redirected to ${classification.adapter}: ${afterUrl}`,
      meta: { redirectedUrl: afterUrl, downstreamAdapter: classification.adapter }
    };
  }
  if (afterUrl !== beforeUrl && classification.adapter) {
    return {
      step,
      advanced: false,
      reason: `RemoteJobs.org redirected to unsupported/manual destination (${classification.reason}): ${afterUrl}`,
      meta: { redirectedUrl: afterUrl, downstreamAdapter: classification.adapter, reason: classification.reason }
    };
  }

  return {
    step,
    advanced: false,
    reason: `RemoteJobs.org did not redirect to an audited ATS after email. Current URL: ${afterUrl}`
  };
}

async function isSubmitted() {
  return noProof('RemoteJobs.org adapter does not submit until post-email destination is audited.');
}

async function verifySubmission() {
  return {
    proof: Proof.NOT_SUBMITTED,
    markers: [],
    reason: 'RemoteJobs.org adapter intentionally stops before submission.'
  };
}

async function waitForTrackedApplyUrl(page) {
  return page.waitForRequest(
    (request) => request.url().includes('/api/track-apply') && request.method() === 'POST',
    { timeout: 10000 }
  ).then((request) => {
    try {
      const payload = JSON.parse(request.postData() || '{}');
      return typeof payload.apply_url === 'string' ? payload.apply_url : '';
    } catch {
      return '';
    }
  }).catch(() => '');
}

async function extractEmbeddedApplyUrl(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const patterns = [
      /"apply_url"\s*:\s*"([^"]+)"/,
      /"applyUrl"\s*:\s*"([^"]+)"/,
      /apply_url\\?":\\?"([^"\\]+)/
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        try {
          return JSON.parse(`"${match[1]}"`);
        } catch {
          return match[1];
        }
      }
    }
    return '';
  }).catch(() => '');
}

export const remoteJobsOrgAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default remoteJobsOrgAdapter;
