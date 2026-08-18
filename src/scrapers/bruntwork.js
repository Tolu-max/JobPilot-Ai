import { compactText, normalizeJobText, stripHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

export class BruntWorkScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('bruntwork', config, siteConfig);
  }

  async fetchJobs() {
    const jobsUrl = this.siteConfig.jobsUrl || this.config.jobsUrl;
    // The listing endpoint is commonly cached by CDNs/proxies. A fresh listing
    // is essential because the pipeline deliberately dedupes previously seen IDs.
    const listingUrl = appendCacheBust(jobsUrl);
    const html = await this.fetchText(listingUrl);
    const jobLinks = sortBruntWorkLinksNewestFirst(parseListingLinks(html, jobsUrl));
    const unseenLinks = linksSinceLastSeen(jobLinks, this.siteConfig.lastSeenJobUrl);
    const ids = jobLinks.map((link) => extractJobId(link.applicationUrl)).filter(Boolean);
    await this.log(`Listing page returned ${jobLinks.length} unique job link(s); unseen since last check=${unseenLinks.length}; newest IDs: ${ids.slice(0, 10).join(', ') || 'none'}.`);

    const limit = this.resolveMaxJobsPerRun();
    // Fetch a wider recent window than the final profile limit. The pipeline
    // performs profile/global dedupe after scraping; limiting here can cause a
    // page of already-processed jobs to mask newer jobs immediately behind it.
    const scanLimit = resolveDetailScanLimit(this.siteConfig, limit);
    const candidateLinks = unseenLinks.length > 0
      ? unseenLinks
      : jobLinks;
    const limitedJobLinks = scanLimit > 0 ? candidateLinks.slice(0, scanLimit) : candidateLinks;
    const jobs = [];
    const failed = [];
    const concurrency = resolveDetailConcurrency(this.siteConfig);

    // Keep the newest-first order while fetching detail pages in bounded batches.
    for (let offset = 0; offset < limitedJobLinks.length; offset += concurrency) {
      const batch = limitedJobLinks.slice(offset, offset + concurrency);
      const results = await Promise.all(batch.map(async (link, batchIndex) => {
        const index = offset + batchIndex;
        try {
          const detailHtml = await this.fetchText(link.applicationUrl);
          const detail = parseJobDetail(detailHtml, link);
          return { index, detail };
        } catch (error) {
          return { index, link, error };
        }
      }));

      for (const result of results.sort((left, right) => left.index - right.index)) {
        if (result.detail) {
          jobs.push(result.detail);
          await this.log(`Scraped job detail: ${result.detail.title}`);
        } else {
          failed.push(result);
          await this.log(`Skipped detail (${result.index + 1}/${limitedJobLinks.length}) for ${result.link.applicationUrl}: ${result.error.message}`);
        }
      }
    }

    await this.log(`Detail scan complete: attempted=${limitedJobLinks.length}, succeeded=${jobs.length}, failed=${failed.length}, concurrency=${concurrency}, profileLimit=${limit}, scanLimit=${scanLimit}.`);

    return filterBruntWorkJobsByRecency(jobs, this.siteConfig);
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      ...rawJob,
      source: 'bruntwork',
      source_site: 'bruntwork'
    });
  }
}

export function linksSinceLastSeen(links, lastSeenJobUrl = '') {
  const marker = String(lastSeenJobUrl || '').trim();
  if (!marker) return links;
  const markerIndex = links.findIndex((link) => String(link.applicationUrl || '') === marker);
  return markerIndex >= 0 ? links.slice(0, markerIndex) : links;
}

function filterBruntWorkJobsByRecency(jobs, siteConfig = {}) {
  const maxAgeDays = Number.parseInt(siteConfig.maxAgeDays, 10);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return jobs;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return jobs.filter((job) => {
    if (!job.postedAt) return true;
    const postedAt = Date.parse(job.postedAt);
    return !Number.isFinite(postedAt) || postedAt >= cutoff;
  });
}

function resolveDetailConcurrency(siteConfig = {}) {
  const value = Number.parseInt(
    siteConfig.detailConcurrency ?? process.env.BRUNTWORK_DETAIL_CONCURRENCY,
    10
  );
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : 5;
}

export function resolveBruntWorkDetailScanLimit(siteConfig = {}, profileLimit = 10) {
  const configured = Number.parseInt(siteConfig.detailScanLimit, 10);
  if (Number.isFinite(configured) && configured > 0) return Math.max(configured, profileLimit > 0 ? profileLimit : configured);
  return profileLimit > 0 ? Math.max(profileLimit * 3, 30) : 100;
}

const resolveDetailScanLimit = resolveBruntWorkDetailScanLimit;

export async function scrapeBruntWorkJobs(config, siteConfig = {}) {
  return new BruntWorkScraper(config, siteConfig).scrape();
}

export async function fetchBruntWorkJobDetail(config, applicationUrl, siteConfig = {}) {
  const scraper = new BruntWorkScraper(config, siteConfig);
  const detailHtml = await scraper.fetchText(applicationUrl);
  const fallbackId = String(applicationUrl || '').split('/').filter(Boolean).at(-1) || 'unknown';
  const link = {
    title: `BruntWork Role ${fallbackId}`,
    applicationUrl,
    source: 'bruntwork',
    source_site: 'bruntwork'
  };
  return scraper.normalizeJob(parseJobDetail(detailHtml, link));
}

export function parseListingLinks(html, baseUrl) {
  // Accept either quote style, absolute URLs, query strings, and /apply links.
  // BruntWork has used all of these forms during frontend changes.
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const links = [];
  let m;
  while ((m = re.exec(html))) {
    const href = m[2];
    const match = href.match(/(?:https?:\/\/[^/]+)?(\/jobs\/\d+)(?:\/apply)?(?:[?#].*)?\/?$/i);
    if (!match) continue;
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const innerText = htmlToText(m[3]);
    links.push({
      title: compactText(innerText) || 'Untitled BruntWork role',
      applicationUrl: new URL(`${path}/apply`, baseUrl).toString(),
      source: 'bruntwork',
      source_site: 'bruntwork'
    });
  }
  return links;
}

function appendCacheBust(value) {
  const url = new URL(value);
  url.searchParams.set('_jp_refresh', Date.now().toString());
  return url.toString();
}

function extractJobId(value) {
  return String(value || '').match(/\/jobs\/(\d+)/i)?.[1] || '';
}

export function sortBruntWorkLinksNewestFirst(links = []) {
  // BruntWork's search page already returns jobs in recency order (newest first).
  // Job IDs are not chronological, so sorting by ID would shuffle the page and
  // repeatedly scrape older listings while missing newer ones. Preserve the
  // original page order instead.
  return [...links];
}

export function parseJobDetail(html, link) {
  const title = firstMatch(html, [
    /<p[^>]*class="[^"]*text-4xl[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    /<p[^>]*class="[^"]*text-3xl[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  ]) || link.title;
  const descriptionHtml = firstMatchRaw(html, [
    /<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class="[^"]*rounded-2xl/i,
    /<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  ]);
  const sidebar = extractSidebar(html);
  const body = htmlToText(descriptionHtml || html);
  const overview = findSection(body, ['client overview', 'job overview', 'about the role', 'about this role', 'position overview', 'position summary', 'the opportunity']);
  const jobDescription = findSection(body, ['job description']);
  const responsibilities = findSection(body, ['core responsibilities', 'responsibilities', 'what you will do', 'duties']);
  const requirements = findSection(body, ['requirements', 'qualifications', 'must have']);
  const descParts = [overview, jobDescription, responsibilities, requirements].filter(Boolean);

  return {
    source: 'bruntwork',
    source_site: 'bruntwork',
    title: compactText(title),
    location: 'Remote',
    description: normalizeJobText(descParts.length > 0 ? descParts.join('\n\n') : body),
    applicationUrl: link.applicationUrl,
    requirements: normalizeJobText(requirements),
    responsibilities: normalizeJobText(responsibilities),
    jobType: sidebar.jobType,
    postedAt: sidebar.postedAt,
    raw: {
      remote: true,
      sourceRemoteDefault: true
    }
  };
}

function firstMatch(html, patterns) {
  const raw = firstMatchRaw(html, patterns);
  return raw ? htmlToText(raw) : '';
}

function firstMatchRaw(html, patterns) {
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function extractSidebar(html) {
  const text = htmlToText(String(html || '').match(/<div[^>]*class="[^"]*w-1\/4[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] || '');
  const jobType = text.match(/Job Type\s+(.+?)\s+Work Schedule/i)?.[1] || '';
  const postedAt = text.match(/Published on\s+([A-Za-z]{3}\s+\d{2}\s+\d{4})/i)?.[1] || '';
  return { jobType: compactText(jobType), postedAt: compactText(postedAt) };
}

function htmlToText(html) {
  const withBreaks = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');
  return stripHtml(withBreaks)
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => compactText(line))
    .filter(Boolean)
    .join('\n');
}

function findSection(body, names) {
  const lines = String(body || '')
    .split(/\n|(?=(?:Client Overview|Job Description|Core Responsibilities|Requirements|Qualifications):?)/i)
    .map((line) => compactText(line))
    .filter(Boolean);
  const start = lines.findIndex((line) =>
    names.some((name) => line.toLowerCase().includes(name))
  );
  if (start === -1) return '';
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      /^(client overview|job description|core responsibilities|requirements|responsibilities|qualifications|benefits|schedule|role|what you)/i.test(line)
  );
  return lines.slice(start, end === -1 ? start + 8 : end).join('\n');
}
