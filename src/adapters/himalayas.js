import { FormStep, Proof, noProof } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  detectDownstreamAdapter,
  gatewayHandoffBlockedReason,
  recordGatewayDestination,
  shouldAllowGatewayHandoff
} from './atsResolver.js';

const NAME = 'himalayas';

export { detectDownstreamAdapter };

function matches(url) {
  return /himalayas\.app\/(?:companies\/[^/]+\/jobs\/|jobs\/)/i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/security verification|malicious bots|performance and security by cloudflare/i.test(body)) {
    return FormStep.CAPTCHA;
  }
  if (/apply|application/i.test(body)) return FormStep.DETAILS;
  return FormStep.UNKNOWN;
}

async function fillStep() {
  // Himalayas is a gateway source page, not the final ATS. Form fill happens downstream.
}

async function advance(page, step, ctx) {
  const beforeUrl = page.url();
  const resolvedUrl = await resolveHimalayasApplyUrl(page, ctx);

  if (!resolvedUrl) {
    return {
      step,
      advanced: false,
      reason: 'Himalayas apply destination could not be resolved from job data, page links, or apply button.'
    };
  }

  const classification = classifyApplyDestination(resolvedUrl, { source: NAME });
  await recordGatewayDestination(ctx, page, classification, resolvedUrl, NAME);

  if (!classification.supported) {
    return {
      step,
      advanced: false,
      reason: `Himalayas resolved to unsupported/manual destination (${classification.reason}): ${resolvedUrl}`,
      meta: { resolvedUrl, downstreamAdapter: classification.adapter, reason: classification.reason }
    };
  }

  if (!shouldAllowGatewayHandoff(classification, ctx.config)) {
    return {
      step,
      advanced: false,
      reason: gatewayHandoffBlockedReason('Himalayas', classification, resolvedUrl),
      meta: { resolvedUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
    };
  }

  if (page.url() !== resolvedUrl) {
    await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  return {
    step: FormStep.DETAILS,
    advanced: page.url() !== beforeUrl,
    reason: `Himalayas resolved to ${classification.adapter}: ${resolvedUrl}`,
    meta: { redirectedUrl: resolvedUrl, downstreamAdapter: classification.adapter }
  };
}

async function isSubmitted() {
  return noProof('Himalayas gateway resolver never submits applications directly.');
}

async function verifySubmission() {
  return {
    proof: Proof.NOT_SUBMITTED,
    markers: [],
    reason: 'Himalayas gateway resolver only hands off to an audited downstream adapter.'
  };
}

export async function resolveHimalayasApplyUrl(page, ctx = {}) {
  // 1. Direct external ATS URL already attached during scraping
  const fromJob = normalizeApplyUrl(
    ctx.job?.raw?.externalApplyUrl ||
    ctx.job?.raw?.apply_url ||
    ctx.job?.applyUrl ||
    ctx.job?.apply_url ||
    ''
  );
  if (fromJob && !isHimalayasJobUrl(fromJob)) return fromJob;

  // 2. Extract apply link from rendered page DOM
  const fromPage = normalizeApplyUrl(await extractApplyUrlFromPage(page));
  if (fromPage && !isHimalayasJobUrl(fromPage)) return fromPage;

  // 3. Click the Apply button on the page and capture popup or navigation
  const fromClick = normalizeApplyUrl(await clickApplyAndCaptureDestination(page));
  if (fromClick && !isHimalayasJobUrl(fromClick)) return fromClick;

  return fromClick || fromPage || fromJob;
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

    // First check for known ATS links
    const anchors = [...document.querySelectorAll('a[href]')];
    for (const anchor of anchors) {
      const href = normalize(anchor.getAttribute('href') || '');
      if (
        /greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|bamboohr\.com|applytojob\.com/i.test(href)
      ) {
        return href;
      }
    }

    // Check for general external apply buttons/links
    const applyCandidates = anchors
      .map((anchor) => ({
        text: `${anchor.textContent || ''} ${anchor.getAttribute('aria-label') || ''}`.trim(),
        href: normalize(anchor.getAttribute('href') || '')
      }))
      .filter((item) => item.href && /apply|application/i.test(item.text));

    for (const item of applyCandidates) {
      try {
        const url = new URL(item.href);
        const host = url.hostname.replace(/^www\./, '');
        if (host !== sameHost && !host.includes('himalayas.app') && !/^mailto:/i.test(item.href)) {
          return item.href;
        }
      } catch {}
    }

    // Check script contents for embedded apply URLs
    const html = document.documentElement.innerHTML;
    const patterns = [
      /"apply_url"\s*:\s*"([^"]+)"/i,
      /"applyUrl"\s*:\s*"([^"]+)"/i,
      /"applicationLink"\s*:\s*"([^"]+)"/i,
      /apply_url\\?":\\?"([^"\\]+)/i,
      /data-apply-url=["']([^"']+)["']/i
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        try {
          const parsed = JSON.parse(`"${match[1]}"`);
          if (parsed && !parsed.includes('himalayas.app')) return parsed;
        } catch {
          if (!match[1].includes('himalayas.app')) return match[1];
        }
      }
    }
    return '';
  }).catch(() => '');
}

async function clickApplyAndCaptureDestination(page) {
  const applyControl = page.locator('a[href*="/apply"], a:has-text("Apply"), button:has-text("Apply")').first();

  if (!(await applyControl.isVisible({ timeout: 5000 }).catch(() => false))) return '';

  const beforeUrl = page.url();
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  const navigationPromise = page
    .waitForURL((url) => url.href !== beforeUrl, { timeout: 10000 })
    .then(() => page.url())
    .catch(() => '');

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

function isHimalayasJobUrl(url) {
  return /himalayas\.app\/(?:companies\/[^/]+\/jobs\/|jobs\/)/i.test(String(url || ''));
}

export const himalayasAdapter = Object.freeze({
  name: NAME,
  allowAdvanceInTestMode: true,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default himalayasAdapter;
