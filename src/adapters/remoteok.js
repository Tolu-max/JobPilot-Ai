import { FormStep, Proof, noProof } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  detectDownstreamAdapter,
  gatewayHandoffBlockedReason,
  recordGatewayDestination,
  shouldAllowGatewayHandoff
} from './atsResolver.js';

const NAME = 'remoteok';

export { detectDownstreamAdapter };

function matches(url) {
  return /remoteok\.com\/remote-jobs\//i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/remote\s*ok/i.test(body) && /apply/i.test(body)) return FormStep.DETAILS;
  return FormStep.UNKNOWN;
}

async function fillStep() {
  // RemoteOK is a source page, not the final ATS. Nothing should be filled here.
}

async function advance(page, step, ctx) {
  const beforeUrl = page.url();
  const resolvedUrl = await resolveRemoteOkApplyUrl(page, ctx);

  if (!resolvedUrl) {
    return {
      step,
      advanced: false,
      reason: 'RemoteOK apply destination could not be resolved from job data, page links, or apply button.'
    };
  }

  const classification = classifyApplyDestination(resolvedUrl, { source: NAME });
  await recordGatewayDestination(ctx, page, classification, resolvedUrl, NAME);
  if (!classification.supported) {
    return {
      step,
      advanced: false,
      reason: `RemoteOK resolved to unsupported/manual destination (${classification.reason}): ${resolvedUrl}`,
      meta: { resolvedUrl, downstreamAdapter: classification.adapter, reason: classification.reason }
    };
  }

  if (!shouldAllowGatewayHandoff(classification, ctx.config)) {
    return {
      step,
      advanced: false,
      reason: gatewayHandoffBlockedReason('RemoteOK', classification, resolvedUrl),
      meta: { resolvedUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
    };
  }

  if (page.url() !== resolvedUrl) {
    await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  return {
    step: FormStep.DETAILS,
    advanced: page.url() !== beforeUrl,
    reason: `RemoteOK resolved to ${classification.adapter}: ${resolvedUrl}`,
    meta: { redirectedUrl: resolvedUrl, downstreamAdapter: classification.adapter }
  };
}

async function isSubmitted() {
  return noProof('RemoteOK resolver never submits applications directly.');
}

async function verifySubmission() {
  return {
    proof: Proof.NOT_SUBMITTED,
    markers: [],
    reason: 'RemoteOK resolver only hands off to an audited downstream adapter.'
  };
}

export async function resolveRemoteOkApplyUrl(page, ctx = {}) {
  const fromJob = normalizeApplyUrl(ctx.job?.raw?.apply_url || ctx.job?.applyUrl || ctx.job?.apply_url || '');
  if (fromJob && !isRemoteOkJobUrl(fromJob)) return fromJob;

  const fromPage = normalizeApplyUrl(await extractApplyUrlFromPage(page));
  if (fromPage && isRemoteOkTrackingUrl(fromPage)) return expandRemoteOkTrackingUrl(page, fromPage);
  if (fromPage && !isRemoteOkJobUrl(fromPage)) return fromPage;

  const fromClick = normalizeApplyUrl(await clickApplyAndCaptureDestination(page));
  if (fromClick && isRemoteOkTrackingUrl(fromClick)) return expandRemoteOkTrackingUrl(page, fromClick);
  return fromClick;
}

export function classifyApplyUrl(url) {
  const classification = classifyApplyDestination(url, { source: NAME });
  return {
    supported: classification.supported,
    adapter: classification.adapter,
    reason: classification.reason
  };
}

async function extractApplyUrlFromPage(page) {
  return page.evaluate(() => {
    const sameHost = location.hostname.replace(/^www\./, '');
    const normalize = (href) => {
      try {
        return new URL(href, location.href).href;
      } catch {
        return '';
      }
    };

    const candidates = [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({
        text: `${anchor.textContent || ''} ${anchor.getAttribute('aria-label') || ''}`.trim(),
        href: normalize(anchor.getAttribute('href') || '')
      }))
      .filter((item) => item.href && /apply|application/i.test(item.text));

    const tracking = candidates.find((item) => /remoteok\.com\/l\/\d+/i.test(item.href));
    if (tracking) return tracking.href;

    for (const item of candidates) {
      const url = new URL(item.href);
      const host = url.hostname.replace(/^www\./, '');
      if (host !== sameHost || /^mailto:/i.test(item.href)) return item.href;
    }

    const html = document.documentElement.innerHTML;
    const patterns = [
      /"apply_url"\s*:\s*"([^"]+)"/i,
      /"applyUrl"\s*:\s*"([^"]+)"/i,
      /apply_url\\?":\\?"([^"\\]+)/i,
      /data-apply-url=["']([^"']+)["']/i
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

async function expandRemoteOkTrackingUrl(page, trackingUrl) {
  const response = await page.context().request.get(trackingUrl, {
    maxRedirects: 10,
    timeout: 30000
  }).catch(() => null);

  const finalUrl = response?.url() || '';
  const manualUrl = await extractManualInstructionUrl(page);
  if (manualUrl) return manualUrl;
  if (finalUrl && finalUrl !== trackingUrl && !isRemoteOkTrackingUrl(finalUrl) && !isRemoteOkJobUrl(finalUrl)) return finalUrl;
  return finalUrl;
}

async function extractManualInstructionUrl(page) {
  return page.evaluate(() => {
    const mailto = document.querySelector('a[href^="mailto:"]')?.getAttribute('href');
    if (mailto) return mailto;
    const external = [...document.querySelectorAll('a[href]')]
      .map((anchor) => anchor.href)
      .find((href) => href && !/remoteok\.com/i.test(href));
    return external || '';
  }).catch(() => '');
}

async function clickApplyAndCaptureDestination(page) {
  const applyControl = page.getByRole('link', { name: /apply/i }).first()
    .or(page.getByRole('button', { name: /apply/i }).first());

  if (!(await applyControl.isVisible({ timeout: 5000 }).catch(() => false))) return '';

  const beforeUrl = page.url();
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  const navigationPromise = page.waitForURL((url) => url.href !== beforeUrl, { timeout: 10000 }).then(() => page.url()).catch(() => '');
  await applyControl.click({ force: true }).catch(() => {});

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    const popupUrl = popup.url();
    await popup.close().catch(() => {});
    return popupUrl;
  }

  return navigationPromise;
}

function normalizeApplyUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function isRemoteOkJobUrl(url) {
  return /remoteok\.com\/remote-jobs\//i.test(String(url || ''));
}

function isRemoteOkTrackingUrl(url) {
  return /remoteok\.com\/l\/\d+/i.test(String(url || ''));
}

export const remoteOkAdapter = Object.freeze({
  name: NAME,
  allowAdvanceInTestMode: true,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default remoteOkAdapter;
