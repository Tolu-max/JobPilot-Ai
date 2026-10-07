import { FormStep, Proof, noProof } from './types.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  detectDownstreamAdapter,
  gatewayHandoffBlockedReason,
  recordGatewayDestination,
  shouldAllowGatewayHandoff
} from './atsResolver.js';

const NAME = 'arbeitnow';

export { detectDownstreamAdapter };

function matches(url) {
  return /arbeitnow\.com\/(?:jobs\/|view\/)/i.test(String(url || ''));
}

async function getCurrentStep(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/apply|application/i.test(body)) return FormStep.DETAILS;
  return FormStep.UNKNOWN;
}

async function fillStep() {
  // Arbeitnow is a gateway source page, not the final ATS. Form fill happens downstream.
}

async function advance(page, step, ctx) {
  const beforeUrl = page.url();
  const resolvedUrl = await resolveArbeitnowApplyUrl(page, ctx);

  if (!resolvedUrl) {
    return {
      step,
      advanced: false,
      reason: 'Arbeitnow apply destination could not be resolved from job data, HTTP redirect, or page links.'
    };
  }

  const classification = classifyApplyDestination(resolvedUrl, { source: NAME });
  await recordGatewayDestination(ctx, page, classification, resolvedUrl, NAME);

  if (!classification.supported) {
    return {
      step,
      advanced: false,
      reason: `Arbeitnow resolved to unsupported/manual destination (${classification.reason}): ${resolvedUrl}`,
      meta: { resolvedUrl, downstreamAdapter: classification.adapter, reason: classification.reason }
    };
  }

  if (!shouldAllowGatewayHandoff(classification, ctx.config)) {
    return {
      step,
      advanced: false,
      reason: gatewayHandoffBlockedReason('Arbeitnow', classification, resolvedUrl),
      meta: { resolvedUrl, downstreamAdapter: classification.adapter, reason: 'live-handoff-disabled' }
    };
  }

  if (page.url() !== resolvedUrl) {
    await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  return {
    step: FormStep.DETAILS,
    advanced: page.url() !== beforeUrl,
    reason: `Arbeitnow resolved to ${classification.adapter}: ${resolvedUrl}`,
    meta: { redirectedUrl: resolvedUrl, downstreamAdapter: classification.adapter }
  };
}

async function isSubmitted() {
  return noProof('Arbeitnow gateway resolver never submits applications directly.');
}

async function verifySubmission() {
  return {
    proof: Proof.NOT_SUBMITTED,
    markers: [],
    reason: 'Arbeitnow gateway resolver only hands off to an audited downstream adapter.'
  };
}

export async function resolveArbeitnowApplyUrl(page, ctx = {}) {
  // 1. Direct external ATS URL already attached during scraping
  const fromJob = normalizeApplyUrl(
    ctx.job?.raw?.externalApplyUrl ||
    ctx.job?.raw?.apply_url ||
    ''
  );
  if (fromJob && !isArbeitnowJobUrl(fromJob)) return fromJob;

  // 2. Resolve via HTTP HEAD redirect on /apply endpoint
  const rawUrl = ctx.job?.raw?.applyUrl || ctx.job?.applicationUrl || ctx.job?.url || '';
  if (rawUrl) {
    const applyEndpoint = rawUrl.endsWith('/apply') ? rawUrl : `${rawUrl.replace(/\/+$/, '')}/apply`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(applyEndpoint, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeout);
      const loc = res.headers.get('location');
      if (loc && !isArbeitnowJobUrl(loc)) {
        return normalizeApplyUrl(loc);
      }
    } catch {}
  }

  // 3. Extract apply link from rendered page DOM
  if (page) {
    const fromPage = normalizeApplyUrl(await extractApplyUrlFromPage(page));
    if (fromPage && !isArbeitnowJobUrl(fromPage)) return fromPage;
  }

  // 4. Direct ATS discovery via company and title search
  const company = ctx.job?.company || ctx.job?.raw?.company_name || '';
  const title = ctx.job?.title || ctx.job?.raw?.title || '';
  if (company && title) {
    const discoveredAts = await discoverDirectAts(company, title);
    if (discoveredAts) return discoveredAts;
  }

  return '';
}

export function classifyApplyUrl(url) {
  const classification = classifyApplyDestination(url, { source: NAME });
  return {
    supported: classification.supported,
    adapter: classification.adapter,
    reason: classification.reason
  };
}

async function discoverDirectAts(company, title) {
  const cleanCompany = String(company || '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const cleanTitle = String(title || '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const query = `"${cleanCompany}" "${cleanTitle}"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return '';

    const html = await res.text();
    const matches = [...html.matchAll(/uddg=([^&"]+)/g)].map((m) => {
      try { return decodeURIComponent(m[1]); } catch { return ''; }
    }).filter(Boolean);

    const auditedAts = matches.find((u) =>
      /greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|bamboohr\.com|applytojob\.com/i.test(u)
    );
    if (auditedAts) return auditedAts;

    return '';
  } catch {
    return '';
  }
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

    const anchors = [...document.querySelectorAll('a[href]')];
    for (const anchor of anchors) {
      const href = normalize(anchor.getAttribute('href') || '');
      if (/greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|bamboohr\.com|applytojob\.com/i.test(href)) {
        return href;
      }
    }

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
        if (host !== sameHost && !host.includes('arbeitnow.com') && !/^mailto:/i.test(item.href)) {
          return item.href;
        }
      } catch {}
    }

    return '';
  }).catch(() => '');
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

function isArbeitnowJobUrl(url) {
  return /arbeitnow\.com\/(?:jobs\/|view\/)/i.test(String(url || ''));
}

export const arbeitnowAdapter = Object.freeze({
  name: NAME,
  allowAdvanceInTestMode: true,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default arbeitnowAdapter;
