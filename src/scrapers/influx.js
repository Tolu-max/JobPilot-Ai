import { compactText, normalizeJobText, stripHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

const DEFAULT_JOBS_URL = 'https://influx.com/careers/jobs';

export class InfluxScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('influx', config, siteConfig);
  }

  async fetchJobs() {
    const jobsUrl = this.siteConfig.jobsUrl || DEFAULT_JOBS_URL;
    const html = await this.fetchText(jobsUrl);
    const links = parseInfluxJobLinks(html, jobsUrl);
    await this.log(`Listing page returned ${links.length} job link(s).`);

    const limit = this.resolveMaxJobsPerRun();
    const limitedLinks = limit > 0 ? links.slice(0, limit) : links;
    const jobs = [];

    for (const link of limitedLinks) {
      try {
        const detailHtml = await this.fetchText(link.jobUrl);
        jobs.push(parseInfluxJobDetail(detailHtml, link.jobUrl, link));
      } catch (error) {
        await this.log(`Skipped detail for ${link.jobUrl}: ${error.message}`);
      }
    }

    const filteredJobs = filterInfluxJobsByPolicy(jobs, this.siteConfig);
    await this.log(`Policy returned ${filteredJobs.length} of ${jobs.length} fetched job(s).`);
    return filteredJobs;
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      ...rawJob,
      source: 'influx',
      source_site: 'influx',
      company: 'Influx'
    });
  }
}

export async function scrapeInfluxJobs(config, siteConfig = {}) {
  return new InfluxScraper(config, siteConfig).scrape();
}

export function parseInfluxJobLinks(html, baseUrl = DEFAULT_JOBS_URL) {
  const links = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']*\/careers\/jobs\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = re.exec(html))) {
    const href = match[1];
    const jobUrl = new URL(href, baseUrl).toString();
    if (seen.has(jobUrl)) continue;
    seen.add(jobUrl);

    links.push({
      title: compactText(stripHtml(match[2])) || 'Untitled Influx role',
      jobUrl,
      applicationUrl: jobUrl
    });
  }

  return links;
}

export function parseInfluxJobDetail(html, jobUrl, fallback = {}) {
  const title = firstMatch(html, /<h2[^>]*>([\s\S]*?)<\/h2>/i) || fallback.title || '';
  const location = firstMatch(html, /<h3[^>]*>([\s\S]*?)<\/h3>/i) || '';
  const applyUrl = firstMatch(
    html,
    /<a[^>]+href=["']([^"']+)["'][^>]*>\s*Apply\s+Here\s*<\/a>/i
  );
  const contentHtml = firstMatch(
    html,
    /<div[^>]+class=["'][^"']*text_block[^"']*["'][^>]*>[\s\S]*?<div[^>]+class=["'][^"']*container[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<div[^>]+class=["'][^"']*container[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  ) || html;
  const contentText = normalizeJobText(stripHtml(contentHtml));

  return {
    source: 'influx',
    source_site: 'influx',
    sourceJobId: sourceJobIdFromUrl(jobUrl),
    title: compactText(stripHtml(title)),
    company: 'Influx',
    location: compactText(stripHtml(location)),
    jobType: 'Remote',
    description: contentText,
    requirements: extractSection(contentText, 'Requirements', ['Benefits', 'Deadline']),
    responsibilities: extractSection(contentText, 'Duties', ['Requirements', 'Benefits']),
    applicationUrl: applyUrl ? normalizeInfluxApplyUrl(new URL(applyUrl, jobUrl).toString()) : fallback.applicationUrl || jobUrl,
    jobUrl,
    raw: {
      jobUrl,
      title: fallback.title
    }
  };
}

export function filterInfluxJobsByPolicy(jobs, siteConfig = {}) {
  const excludedTitleKeywords = (siteConfig.excludedTitleKeywords || [])
    .map((keyword) => String(keyword || '').trim().toLowerCase())
    .filter(Boolean);
  const eligibleJobs = jobs.filter((job) => {
    const title = String(job.title || '').toLowerCase();
    return !excludedTitleKeywords.some((keyword) => title.includes(keyword));
  });

  const preferredLocations = (siteConfig.preferredLocations || [])
    .map((location) => String(location || '').trim().toLowerCase())
    .filter(Boolean);
  if (!preferredLocations.length) return eligibleJobs;

  const preferredJobs = eligibleJobs.filter((job) => {
    const location = String(job.location || '').trim().toLowerCase();
    return preferredLocations.some((preferred) => location.includes(preferred));
  });
  if (preferredJobs.length > 0) return preferredJobs;

  return siteConfig.allowOtherLocationsWhenNoPreferred === true ? eligibleJobs : [];
}

function firstMatch(value, pattern) {
  const match = pattern.exec(value || '');
  return match ? match[1] : '';
}

function extractSection(text, startLabel, stopLabels = []) {
  const start = text.toLowerCase().indexOf(startLabel.toLowerCase());
  if (start === -1) return '';

  const fromStart = text.slice(start + startLabel.length).trim();
  const stopPositions = stopLabels
    .map((label) => fromStart.toLowerCase().indexOf(label.toLowerCase()))
    .filter((index) => index >= 0);
  const end = stopPositions.length ? Math.min(...stopPositions) : fromStart.length;
  return normalizeJobText(fromStart.slice(0, end));
}

function sourceJobIdFromUrl(url) {
  const pathname = new URL(url).pathname;
  const match = /\/careers\/jobs\/([^/]+)/.exec(pathname);
  return match ? match[1] : pathname;
}

function normalizeInfluxApplyUrl(url) {
  const parsed = new URL(url);
  const formId = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (parsed.hostname === 'influx.com' && parsed.pathname.startsWith('/forms/') && formId) {
    return `https://influx.typeform.com/to/${formId}${parsed.search}`;
  }
  return url;
}
