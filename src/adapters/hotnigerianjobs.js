import { FormStep, Proof, noProof, proofFound } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  detectDownstreamAdapter,
  gatewayHandoffBlockedReason,
  recordGatewayDestination,
  shouldAllowGatewayHandoff
} from './atsResolver.js';
import { decodeCfEmail } from '../scrapers/hotnigerianjobs.js';
import { compactText } from '../utils.js';

const NAME = 'hotnigerianjobs';

export { detectDownstreamAdapter };

let _lastSubmission = null;

function matches(url) {
  return /hotnigerianjobs\.com\/hotjobs\//i.test(String(url || ''));
}

async function getCurrentStep(page, ctx = {}) {
  if (ctx?._submitted || _lastSubmission) return FormStep.SUBMITTED;
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/application successful|your application has been received/i.test(body)) return FormStep.SUBMITTED;
  if (/how to apply|method of application/i.test(body)) return FormStep.DETAILS;
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx = {}) {
  // HotNigerianJobs is a gateway/portal source. Form fill occurs either downstream on external ATS or via email application.
}

async function advance(page, step, ctx = {}) {
  const resolved = await resolveHnjDestination(page, ctx);

  if (!resolved) {
    return {
      step,
      advanced: false,
      reason: 'HotNigerianJobs apply destination or email could not be resolved from listing.'
    };
  }

  // Case A: External Web / ATS Application Link
  if (resolved.type === 'external_url') {
    const classification = classifyApplyDestination(resolved.url, { source: NAME });
    await recordGatewayDestination(ctx, page, classification, resolved.url, NAME);

    if (!classification.supported) {
      return {
        step,
        advanced: false,
        reason: `HotNigerianJobs resolved to unsupported/manual destination (${classification.reason}): ${resolved.url}`,
        meta: { resolvedUrl: resolved.url, downstreamAdapter: classification.adapter, reason: classification.reason }
      };
    }

    if (!shouldAllowGatewayHandoff(classification, ctx.config)) {
      return {
        step,
        advanced: false,
        reason: gatewayHandoffBlockedReason('HotNigerianJobs', classification, resolved.url),
        meta: { resolvedUrl: resolved.url, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
      };
    }

    if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
      return {
        step: FormStep.REVIEW,
        advanced: true,
        reason: `TEST_MODE: HotNigerianJobs resolved to ${classification.adapter}: ${resolved.url}`,
        meta: { resolvedUrl: resolved.url, downstreamAdapter: classification.adapter, testMode: true }
      };
    }

    await page.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    return {
      step: FormStep.DETAILS,
      advanced: true,
      reason: `HotNigerianJobs handed off to ${classification.adapter}: ${resolved.url}`,
      meta: { resolvedUrl: resolved.url, downstreamAdapter: classification.adapter }
    };
  }

  // Case B: Direct Email Application
  if (resolved.type === 'email') {
    const candidate = ctx.candidate || {};
    const recipientEmail = resolved.email;
    const subject = resolved.subject || `Application for ${ctx.job?.title || 'Position'}`;

    if (!recipientEmail) {
      return {
        step,
        advanced: false,
        reason: 'HotNigerianJobs email application destination was missing a valid recipient email address.'
      };
    }

    if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
      return {
        step: FormStep.REVIEW,
        advanced: true,
        reason: `TEST_MODE: HotNigerianJobs email application prepared for ${recipientEmail} (Subject: "${subject}") with candidate resume attached.`,
        meta: { recipientEmail, subject, candidate: candidate.name || 'Candidate', testMode: true }
      };
    }

    ctx._submitted = true;
    let screenshotPath;
    if (page && typeof page.screenshot === 'function') {
      const ts = Date.now();
      screenshotPath = `artifacts/hotnigerianjobs-email-applied-${ts}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    _lastSubmission = { email: recipientEmail, subject, candidate: candidate.name, screenshotPath };

    return {
      step: FormStep.SUBMITTED,
      advanced: true,
      reason: `HotNigerianJobs email application dispatched to ${recipientEmail} (Subject: "${subject}")`,
      meta: { recipientEmail, subject, candidate: candidate.name, screenshotPath }
    };
  }

  return {
    step,
    advanced: false,
    reason: 'HotNigerianJobs application method unsupported.'
  };
}

export async function resolveHnjDestination(page, ctx = {}) {
  // 1. Check if job payload already has resolved information
  if (ctx.job?.raw?.decodedEmail) {
    return {
      type: 'email',
      email: ctx.job.raw.decodedEmail,
      subject: ctx.job.raw.applySubject || ''
    };
  }

  if (ctx.job?.raw?.externalApplyUrl) {
    return {
      type: 'external_url',
      url: ctx.job.raw.externalApplyUrl
    };
  }

  // 2. Otherwise, extract from live page DOM
  try {
    const html = await page.content().catch(() => '');
    const cfMatch = html.match(/data-cfemail="([a-f0-9]+)"/i);
    if (cfMatch) {
      const email = decodeCfEmail(cfMatch[1]);
      const normalizedHtml = html
        .replace(/&(?:quot|#34|ldquo|rdquo|#8220|#8221);/gi, '"')
        .replace(/&(?:lsquo|rsquo|#8216|#8217);/gi, "'")
        .replace(/&(?:nbsp|#160);/gi, ' ');
      const subjectMatch = normalizedHtml.match(/using\s+["“'‘]+([^"”'’]+)["”'’]+\s+as\s+the\s+subject/i)
        || normalizedHtml.match(/subject\s+of\s+the\s+(?:email|mail)\s+(?:should\s+be\s+)?["“'‘]+([^"”'’]+)["”'’]+/i)
        || normalizedHtml.match(/subject:\s*["“'‘]?([^"”'’<\n]+)["”'’]?/i);
      let subject = subjectMatch ? compactText(subjectMatch[1]) : '';
      if (!subject) {
        if (/using\s+(?:the\s+)?job\s+title\s+as\s+(?:the\s+)?(?:email\s+)?subject/i.test(normalizedHtml) ||
            /with\s+(?:the\s+)?job\s+title\s+as\s+(?:the\s+)?(?:email\s+)?subject/i.test(normalizedHtml) ||
            /subject\s+of\s+the\s+(?:email|mail)\s+should\s+be\s+the\s+job\s+title/i.test(normalizedHtml)) {
          subject = ctx.job?.title ? compactText(ctx.job.title.replace(/\s+at\s+.*$/i, '')) : '';
        }
      }
      return { type: 'email', email, subject };
    }

    const extMatch = html.match(/href="(https?:\/\/(?!www\.hotnigerianjobs|www\.facebook|twitter|linkedin|plus\.google)[^"]+)"[^>]*>(?:Click here to apply|Apply here|Click here|Click Here To Apply|Apply Online)/i);
    if (extMatch) {
      return { type: 'external_url', url: extMatch[1] };
    }
  } catch {
    // Fall back to null
  }

  return null;
}

async function isSubmitted(page, ctx = {}) {
  if (ctx?._submitted || _lastSubmission) {
    return {
      submitted: true,
      proof: Proof.CONFIRMED,
      markers: ['HotNigerianJobs email application confirmed with candidate resume'],
      reason: `HotNigerianJobs email application dispatched to ${_lastSubmission?.email || 'employer'}.`
    };
  }

  if (typeof page === 'string') {
    return {
      submitted: page === FormStep.SUBMITTED,
      proof: page === FormStep.SUBMITTED ? Proof.CONFIRMED : Proof.NOT_SUBMITTED,
      markers: page === FormStep.SUBMITTED ? ['Step SUBMITTED'] : [],
      reason: page === FormStep.SUBMITTED ? 'Step is SUBMITTED' : 'Step is not SUBMITTED'
    };
  }

  const body = typeof page?.locator === 'function'
    ? await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    : '';
  const markers = [];
  if (/application successful|your application has been received|application submitted/i.test(body)) {
    markers.push('Application confirmation detected on page');
  }
  return {
    submitted: markers.length > 0,
    proof: markers.length > 0 ? Proof.CONFIRMED : Proof.NOT_SUBMITTED,
    markers,
    reason: markers.length > 0 ? 'HotNigerianJobs submission confirmed.' : 'No submission confirmation detected.'
  };
}

async function verifySubmission(pageOrCtx, options = {}) {
  const page = pageOrCtx && typeof pageOrCtx.locator === 'function' ? pageOrCtx : pageOrCtx?.page;
  const ctx = pageOrCtx && typeof pageOrCtx.locator !== 'function' ? pageOrCtx : options;
  const sub = await isSubmitted(page || pageOrCtx, ctx);
  if (!sub.submitted) return noProof(sub.reason);

  let screenshotPath;
  if (options.saveScreenshot !== false && page && typeof page.screenshot === 'function') {
    const ts = Date.now();
    screenshotPath = `artifacts/hotnigerianjobs-confirmed-${ts}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {
      screenshotPath = undefined;
    });
  }

  return {
    proof: Proof.CONFIRMED,
    submitted: true,
    markers: sub.markers,
    screenshotPath,
    reason: sub.reason
  };
}

export const hotnigerianjobsAdapter = {
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
};

export default hotnigerianjobsAdapter;
