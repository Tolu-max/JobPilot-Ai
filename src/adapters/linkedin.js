import { FormStep } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  recordGatewayDestination,
  gatewayHandoffBlockedReason,
  detectDownstreamAdapter
} from './atsResolver.js';
import { compactText } from '../utils.js';
import { loadLinkedinCookies } from '../scrapers/linkedin.js';

const NAME = 'linkedin';

export function matches(url) {
  if (!url || typeof url !== 'string') return false;
  return /linkedin\.com\/jobs\/(?:view|collections|search)/i.test(url) ||
    /linkedin\.com\/jobs\/view\/\d+/i.test(url);
}

export function unwrapLinkedinRedirect(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const candidateParams = ['url', 'targetUrl', 'redirect', 'dest'];
    for (const param of candidateParams) {
      const val = parsed.searchParams.get(param);
      if (val && /^https?:\/\//i.test(val)) {
        return val;
      }
    }
  } catch {}
  return '';
}

export async function resolveLinkedinDestination(page, ctx = {}) {
  const currentUrl = typeof page?.url === 'function' ? page.url() : '';

  // 1. Check if external URL is explicitly passed in raw payload or job object
  if (ctx.job?.raw?.externalApplyUrl || ctx.job?.externalApplyUrl) {
    return { type: 'external_url', url: ctx.job.raw?.externalApplyUrl || ctx.job.externalApplyUrl };
  }

  // 2. Check if job payload indicates Native Easy Apply
  if (ctx.job?.hasEasyApply || ctx.job?.raw?.hasEasyApply) {
    return { type: 'easy_apply' };
  }

  // 3. Live DOM inspection
  if (page && typeof page.evaluate === 'function') {
    try {
      const liveInfo = await page.evaluate(() => {
        const body = (document.body && document.body.innerText) || '';
        if (/no longer accepting applications|job is no longer available|this job listing has expired/i.test(body)) {
          return { type: 'expired' };
        }

        // Selector strategy: First check for standard Easy Apply button classes, fallback to text matching
        const easyApplyBtn = document.querySelector('.jobs-apply-button--top-card, [data-control-name="jobdetail_topcard_inapply"]') ||
          Array.from(document.querySelectorAll('button, a')).find(el => {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            return /easy apply/i.test(text) || /easy apply/i.test(ariaLabel);
          });

        if (easyApplyBtn) {
          return { type: 'easy_apply' };
        }

        // Selector strategy: Check for external apply buttons, fallback to text matching
        const externalBtn = document.querySelector('.jobs-apply-button--external') ||
          Array.from(document.querySelectorAll('button, a')).find(el => {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            return /apply on company website|apply now/i.test(text) || /apply on company website/i.test(ariaLabel);
          });

        if (externalBtn) {
          let href = externalBtn.getAttribute('href') || '';
          if (href && !href.includes('linkedin.com/jobs/view')) {
            return { type: 'external_url', url: href };
          }
          return { type: 'company_apply_button' };
        }

        return null;
      }).catch(() => null);

      if (liveInfo) return liveInfo;
    } catch {}
  }

  // Fallback: Assume external company apply if standard job view link
  return { type: 'external_url', url: ctx.job?.applicationUrl || currentUrl };
}

export async function advance(page, step, ctx = {}) {
  // 1. Check if expired
  if (page && typeof page.evaluate === 'function') {
    const isExpired = await page.evaluate(() => {
      const body = (document.body && document.body.innerText) || '';
      return /no longer accepting applications|job is no longer available|this job listing has expired/i.test(body);
    }).catch(() => false);

    if (isExpired) {
      return {
        step,
        advanced: false,
        reason: 'This job has expired on LinkedIn (no longer accepting applications).',
        meta: { expired: true, manualReview: false }
      };
    }
  }

  const resolved = await resolveLinkedinDestination(page, ctx);

  if (resolved?.type === 'expired') {
    return {
      step,
      advanced: false,
      reason: 'This job has expired on LinkedIn (no longer accepting applications).',
      meta: { expired: true, manualReview: false }
    };
  }

  // Case A: External Company ATS / Gateway Apply
  if (resolved?.type === 'external_url' || resolved?.type === 'company_apply_button') {
    let targetUrl = resolved.url || ctx.job?.applicationUrl;

    if (resolved.type === 'company_apply_button' && page) {
      try {
        const applyBtn = page.locator('button:has-text("Apply on company website"), a:has-text("Apply on company website"), button:has-text("Apply")').first();
        if (await applyBtn.isVisible().catch(() => false)) {
          const [popup] = await Promise.all([
            page.context()?.waitForEvent('page', { timeout: 8000 }).catch(() => null),
            applyBtn.click().catch(() => {})
          ]);

          if (popup) {
            await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
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
      } catch {}
    }

    const unwrapped = unwrapLinkedinRedirect(targetUrl);
    if (unwrapped) targetUrl = unwrapped;

    const classification = classifyApplyDestination(targetUrl, { source: NAME, job: ctx.job });
    await recordGatewayDestination(ctx, page, classification, targetUrl, NAME);

    const allowCompany = Boolean(
      ctx.config?.allowCompanyWebsites ||
      ctx.config?.allowGatewayAutoSubmit ||
      ctx.job?.acceptedViaTelegram
    );

    if (!classification.supported) {
      if (allowCompany && /^https?:\/\//i.test(targetUrl) && !matches(targetUrl)) {
        console.log(`[Adapter:linkedin] External company website allowed (${targetUrl}). Handing off to generic form filler...`);
        if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
          return {
            step: FormStep.REVIEW,
            advanced: true,
            reason: `TEST_MODE: LinkedIn resolved to company website (generic): ${targetUrl}`,
            meta: { resolvedUrl: targetUrl, downstreamAdapter: 'generic', testMode: true }
          };
        }

        if (page && typeof page.goto === 'function' && page.url() !== targetUrl) {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
        return {
          outcome: 'gateway_handoff',
          externalUrl: targetUrl,
          step: FormStep.DETAILS,
          advanced: true,
          handoffToGeneric: true,
          targetUrl,
          reason: `LinkedIn handed off to company website: ${targetUrl}`,
          meta: { resolvedUrl: targetUrl, downstreamAdapter: 'generic' }
        };
      }

      return {
        step,
        advanced: false,
        reason: `LinkedIn external role redirects via company site gateway: ${targetUrl}`,
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, reason: classification.reason, manualReview: true }
      };
    }

    if (!ctx.config?.allowGatewayLiveHandoff && !ctx.config?.allowGatewayAutoSubmit && !ctx.job?.acceptedViaTelegram) {
      return {
        step,
        advanced: false,
        reason: gatewayHandoffBlockedReason('LinkedIn', classification, targetUrl),
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
      };
    }

    if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
      return {
        step: FormStep.REVIEW,
        advanced: true,
        reason: `TEST_MODE: LinkedIn resolved to ${classification.adapter}: ${targetUrl}`,
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, testMode: true }
      };
    }

    if (page && typeof page.goto === 'function' && page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    return {
      outcome: 'gateway_handoff',
      externalUrl: targetUrl,
      step: FormStep.DETAILS,
      advanced: true,
      reason: `LinkedIn handed off to ${classification.adapter}: ${targetUrl}`,
      meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter }
    };

    // Supported ATS (Greenhouse, Lever, Ashby, Workable, BambooHR, SmartRecruiters)
    if (!ctx.config?.allowGatewayLiveHandoff && !ctx.config?.allowGatewayAutoSubmit && !ctx.job?.acceptedViaTelegram) {
      return {
        step,
        advanced: false,
        reason: gatewayHandoffBlockedReason('LinkedIn', classification, targetUrl),
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
      };
    }

    if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
      return {
        step: FormStep.REVIEW,
        advanced: true,
        reason: `TEST_MODE: LinkedIn resolved to ${classification.adapter}: ${targetUrl}`,
        meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter, testMode: true }
      };
    }

    if (page && typeof page.goto === 'function' && page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    return {
      step: FormStep.DETAILS,
      advanced: true,
      reason: `LinkedIn handed off to ${classification.adapter}: ${targetUrl}`,
      meta: { resolvedUrl: targetUrl, downstreamAdapter: classification.adapter }
    };
  }

  // Case B: LinkedIn Easy Apply
  const candidate = ctx.candidate || {};
  const cookies = await loadLinkedinCookies(ctx.config?.profileName, ctx.config);

  if (page && typeof page.context === 'function' && cookies?.length) {
    await page.context().addCookies(cookies).catch(() => {});
  }

  if (ctx.config?.testMode || ctx.config?.noRealSubmission) {
    return {
      step: FormStep.REVIEW,
      advanced: true,
      reason: `TEST_MODE: LinkedIn Easy Apply prepared for ${candidate.name || 'Candidate'} (${ctx.job?.title || 'Job'}). Session authenticated: ${Boolean(cookies?.length)}. Ready for review.`,
      meta: { easyApply: true, authenticated: Boolean(cookies?.length), testMode: true }
    };
  }

  // In live mode without cookies, prompt for review
  if (!cookies?.length) {
    return {
      step,
      advanced: false,
      reason: 'LinkedIn Easy Apply requires authenticated session cookies (profiles/<profile>/linkedin_cookies.json). Queued for manual review.',
      meta: { easyApply: true, authenticated: false, manualReview: true }
    };
  }

  // Click Easy Apply button
  if (page && typeof page.locator === 'function') {
    const easyBtn = page.locator('button.jobs-apply-button, button:has-text("Easy Apply")').first();
    if (await easyBtn.isVisible().catch(() => false)) {
      await easyBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Check if next button is present
    const nextBtn = page.locator('button[aria-label="Continue to next step"], button:has-text("Next"), button[aria-label="Review your application"], button:has-text("Review")').first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
      return { step: FormStep.REVIEW, advanced: true, reason: 'Advanced Easy Apply modal to review.' };
    }

    const submitBtn = page.locator('button[aria-label="Submit application"], button:has-text("Submit application")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click().catch(() => {});
      await page.waitForTimeout(3000);
      return { step: FormStep.SUBMITTED, advanced: true, reason: 'Submitted LinkedIn Easy Apply application.' };
    }
  }

  return {
    step: FormStep.DETAILS,
    advanced: true,
    reason: 'LinkedIn Easy Apply active.'
  };
}

export async function getCurrentStep(page) {
  if (!page || typeof page.evaluate !== 'function') return FormStep.DETAILS;
  const isDone = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return /application submitted|your application was sent|application sent/i.test(text);
  }).catch(() => false);

  if (isDone) return FormStep.SUBMITTED;
  return FormStep.DETAILS;
}

export async function fillStep(page, step, ctx = {}) {
  // Handled in standard form fill pipeline
  return { filled: true };
}

export async function isSubmitted(page) {
  if (!page || typeof page.evaluate !== 'function') {
    return { submitted: false, markers: [] };
  }
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const markers = [];
  if (/application submitted/i.test(text)) markers.push('Application submitted');
  if (/your application was sent/i.test(text)) markers.push('Your application was sent');
  if (/application sent/i.test(text)) markers.push('Application sent');

  return {
    submitted: markers.length > 0,
    markers
  };
}

export async function verifySubmission(page) {
  return isSubmitted(page);
}

export default {
  name: NAME,
  matches,
  advance,
  getCurrentStep,
  fillStep,
  isSubmitted,
  verifySubmission,
  unwrapLinkedinRedirect,
  resolveLinkedinDestination
};
