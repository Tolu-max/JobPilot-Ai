import { BaseScraper, normalizeList } from './baseScraper.js';
import { compactText, stripHtml, unescapeHtml } from '../utils.js';
import { matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';

const BASE_URL = 'https://dailyremote.com';
const DEFAULT_CATEGORIES = [
  'remote-software-development-jobs',
  'remote-customer-support-jobs',
  'remote-virtual-assistant-jobs',
  'remote-data-entry-jobs'
];

export class DailyRemoteScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('dailyremote', config, siteConfig);
  }

  async fetchJobs() {
    const boardUrls = resolveDailyRemoteBoardUrls(this.siteConfig);
    await this.log(`Scanning ${boardUrls.length} DailyRemote category board(s).`);

    const candidateLinks = [];
    const seen = new Set();

    for (const boardUrl of boardUrls) {
      try {
        const html = await this.fetchText(boardUrl);
        const cards = parseDailyRemoteListingCards(html, boardUrl);
        await this.log(`[${boardUrl}] returned ${cards.length} un-locked job card(s).`);

        for (const card of cards) {
          if (seen.has(card.jobUrl)) continue;
          seen.add(card.jobUrl);
          candidateLinks.push(card);
        }
      } catch (error) {
        await this.log(`Skipped category ${boardUrl}: ${error.message}`);
      }
    }

    const limit = this.resolveMaxJobsPerRun() || 15;
    const scanLimit = Math.max(limit * 2, 20);
    const toEnrich = candidateLinks.slice(0, scanLimit);
    const jobs = [];

    for (const link of toEnrich) {
      try {
        const detailHtml = await this.fetchText(link.jobUrl);
        const detail = parseDailyRemoteJobDetail(detailHtml, link);
        const destinationUrl = await this.resolveOutboundApplyUrl(detail.applyUrl || link.applyUrl);
        if (destinationUrl) {
          detail.applicationUrl = destinationUrl;
        }
        jobs.push(detail);
      } catch (error) {
        await this.log(`Skipped detail for ${link.jobUrl}: ${error.message}`);
        jobs.push(link);
      }
    }

    return jobs;
  }

  async resolveOutboundApplyUrl(applyUrl) {
    if (!applyUrl || !applyUrl.includes('/apply/')) return applyUrl;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(applyUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      const location = response.headers.get('location');
      if (location && !location.includes('paygate') && !location.includes('get-started')) {
        return location.startsWith('/') ? new URL(location, BASE_URL).toString() : location;
      }
    } catch {
      // Outbound resolution is best-effort enhancement
    }
    return applyUrl;
  }

  normalizeJob(rawJob) {
    const tags = normalizeList(rawJob.tags || rawJob.keywords);
    return super.normalizeJob({
      source: 'dailyremote',
      source_site: 'dailyremote',
      sourceJobId: rawJob.sourceJobId || rawJob.id || extractDailyRemoteJobId(rawJob.jobUrl || rawJob.applicationUrl),
      title: rawJob.title,
      company: rawJob.company || 'Unknown',
      location: rawJob.location || 'Remote',
      jobType: rawJob.jobType || 'Full-Time',
      salary: rawJob.salary || '',
      description: rawJob.description || rawJob.summary || '',
      requirements: rawJob.requirements || rawJob.summary || '',
      responsibilities: rawJob.responsibilities || '',
      requiredSkills: tags,
      tags,
      applicationUrl: rawJob.applicationUrl || rawJob.applyUrl || rawJob.jobUrl,
      postedAt: rawJob.postedAt || new Date().toISOString(),
      is_remote: true,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

export function resolveDailyRemoteBoardUrls(siteConfig = {}) {
  const explicit = normalizeList(siteConfig.jobsUrls);
  if (explicit.length) return explicit;
  if (siteConfig.jobsUrl) return [siteConfig.jobsUrl];

  const categories = normalizeList(siteConfig.categories);
  const targets = categories.length ? categories : DEFAULT_CATEGORIES;

  return targets.map((cat) => {
    if (/^https?:\/\//i.test(cat)) return cat;
    const slug = cat.replace(/^\/+|\/+$/g, '');
    return `${BASE_URL}/${slug}`;
  });
}

export function parseDailyRemoteListingCards(html, baseUrl = BASE_URL) {
  const cards = [];
  const articleMatches = [...String(html || '').matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];

  for (const match of articleMatches) {
    const block = match[0];
    // Skip locked/paywalled jobs with hidden companies
    if (block.includes('Company hidden') || block.includes('lst-card__locked')) {
      continue;
    }

    const idMatch = block.match(/data-id=["'](\d+)["']/i);
    const linkMatch = block.match(/<a\b[^>]+href=["'](\/remote-job\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const relativePath = linkMatch[1];
    const rawTitle = unescapeHtml(stripHtml(linkMatch[2]));
    const jobId = idMatch ? idMatch[1] : extractDailyRemoteJobId(relativePath);
    const fullJobUrl = new URL(relativePath, baseUrl).toString();
    const applyUrl = jobId ? `${BASE_URL}/apply/${jobId}` : fullJobUrl;

    const companyMatch = block.match(/<div[^>]*class=["']lst-card__byline["'][^>]*>([\s\S]*?)<\/div>/i);
    let company = '';
    if (companyMatch) {
      const bylineText = stripHtml(companyMatch[1]).replace(/&middot;/g, '·').trim();
      const parts = bylineText.split('·').map((p) => p.trim()).filter(Boolean);
      if (parts[0] && !/full time|part time|contract|ago|company hidden/i.test(parts[0])) {
        company = parts[0];
      }
    }

    const summaryMatch = block.match(/<p[^>]*class=["']lst-card__summary["'][^>]*>([\s\S]*?)<\/p>/i);
    const summary = summaryMatch ? compactText(stripHtml(summaryMatch[1])) : '';

    const tagMatches = [...block.matchAll(/<a\b[^>]+class=["'][^"']*lst-tag[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const tags = tagMatches.map((m) => compactText(stripHtml(m[1]))).filter(Boolean);

    const pillMatches = [...block.matchAll(/<span\b[^>]*class=["'][^"']*lst-pill[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)];
    let location = 'Remote';
    let salary = '';
    for (const pill of pillMatches) {
      const text = compactText(stripHtml(pill[1]));
      if (/\$|€|£|per year|per month|per hour/i.test(text)) {
        salary = text;
      } else if (!/exp|yrs/i.test(text) && text.length > 2) {
        location = text;
      }
    }

    cards.push({
      sourceJobId: jobId,
      title: compactText(rawTitle),
      company: compactText(company),
      location: compactText(location),
      salary: compactText(salary),
      summary,
      tags,
      jobUrl: fullJobUrl,
      applicationUrl: applyUrl,
      applyUrl,
      source: 'dailyremote',
      source_site: 'dailyremote'
    });
  }

  return cards;
}

export function parseDailyRemoteJobDetail(html = '', fallback = {}) {
  const jsonLdMatches = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      if (data && (data['@type'] === 'JobPosting' || data.type === 'JobPosting')) {
        const title = compactText(data.title || fallback.title || '');
        const company = compactText(data.hiringOrganization?.name || fallback.company || '');
        const description = compactText(stripHtml(data.description || fallback.summary || ''));
        const postedAt = data.datePosted ? new Date(data.datePosted).toISOString() : fallback.postedAt;
        const jobType = compactText(data.employmentType || fallback.jobType || '');
        const id = data.identifier?.value || fallback.sourceJobId || '';

        return {
          ...fallback,
          sourceJobId: id,
          title,
          company,
          description,
          jobType,
          postedAt,
          raw: {
            ...fallback.raw,
            ...data
          }
        };
      }
    } catch {
      // Ignore unparseable blocks
    }
  }

  return fallback;
}

export function extractDailyRemoteJobId(url = '') {
  const match = String(url || '').match(/-(\d+)(?:[/?#]|$)/);
  return match ? match[1] : '';
}

export async function scrapeDailyRemoteJobs(config, siteConfig = {}) {
  return new DailyRemoteScraper(config, siteConfig).scrape();
}
