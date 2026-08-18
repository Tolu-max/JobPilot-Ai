import { appendLog } from '../logger.js';
import { createJobHash, normalizeUrl } from '../jobHash.js';
import { compactText, normalizeJobText, stripHtml, uniqueBy } from '../utils.js';

export class BaseScraper {
  constructor(siteName, config = {}, siteConfig = {}) {
    this.siteName = siteName;
    this.config = config;
    this.siteConfig = siteConfig || {};
  }

  async fetchJobs() {
    throw new Error(`${this.siteName} scraper must implement fetchJobs().`);
  }

  normalizeJob(rawJob = {}) {
    const source = compactText(rawJob.source_site || rawJob.source || this.siteName).toLowerCase();
    const applicationUrl = normalizeUrl(
      rawJob.applicationUrl || rawJob.applyUrl || rawJob.jobUrl || rawJob.url || rawJob.job_url
    );
    const requiredSkills = normalizeList(rawJob.requiredSkills || rawJob.skills || rawJob.tags);
    const tags = normalizeList(rawJob.tags || rawJob.categories || rawJob.keywords);

    const job = {
      source,
      source_site: source,
      sourceJobId: compactText(rawJob.sourceJobId || rawJob.externalId || rawJob.id),
      title: compactText(rawJob.title || rawJob.position || rawJob.name),
      company: compactText(rawJob.company || rawJob.companyName || rawJob.organization),
      location: compactText(rawJob.location || rawJob.region || rawJob.candidateRequiredLocation),
      jobType: compactText(rawJob.jobType || rawJob.employmentType || rawJob.type),
      salary: compactText(rawJob.salary || rawJob.compensation),
      description: normalizeJobText(stripHtml(rawJob.description || rawJob.body || rawJob.summary)),
      requirements: normalizeJobText(stripHtml(rawJob.requirements || rawJob.required || requiredSkills.join(', '))),
      responsibilities: normalizeJobText(stripHtml(rawJob.responsibilities || rawJob.duties)),
      requiredSkills,
      tags,
      keywords: normalizeList(rawJob.keywords),
      applicationUrl,
      postedAt: compactText(rawJob.postedAt || rawJob.date || rawJob.publicationDate),
      raw: rawJob.raw || rawJob
    };

    job.jobHash = this.getJobHash(job);
    return job;
  }

  getJobHash(job) {
    return createJobHash(job);
  }

  isJobSupported(job) {
    return Boolean(job.title && job.applicationUrl);
  }

  async scrape() {
    const rawJobs = await this.fetchJobs();
    const normalizedJobs = rawJobs
      .map((job) => this.normalizeJob(job))
      .filter((job) => this.isJobSupported(job))
      .filter((job) => this.matchesSitePolicy(job));

    const deduped = uniqueBy(normalizedJobs, (job) => job.jobHash || job.applicationUrl);
    const limit = this.resolveMaxJobsPerRun();
    return limit > 0 ? deduped.slice(0, limit) : deduped;
  }

  matchesSitePolicy(job) {
    const includeKeywords = normalizeList(this.siteConfig.includeKeywords);
    const includeTitleKeywords = normalizeList(this.siteConfig.includeTitleKeywords);
    const excludeKeywords = normalizeList(this.siteConfig.excludeKeywords);
    if (!includeKeywords.length && !includeTitleKeywords.length && !excludeKeywords.length) return true;

    const title = compactText(job.title).toLowerCase();
    const text = [
      job.title,
      job.company,
      job.description,
      job.requirements,
      job.responsibilities,
      ...(job.requiredSkills || []),
      ...(job.tags || [])
    ].map((value) => compactText(value).toLowerCase()).join(' ');

    if (excludeKeywords.some((keyword) => text.includes(keyword.toLowerCase()))) return false;
    if (includeTitleKeywords.length && !includeTitleKeywords.some((keyword) => title.includes(keyword.toLowerCase()))) return false;
    if (includeKeywords.length && !includeKeywords.some((keyword) => text.includes(keyword.toLowerCase()))) return false;
    return true;
  }

  resolveMaxJobsPerRun() {
    if (this.config?.hasMaxJobsOverride) {
      const globalLimit = Number.parseInt(this.config.maxJobsPerRun, 10);
      if (Number.isFinite(globalLimit)) return globalLimit;
    }

    const siteLimit = Number.parseInt(this.siteConfig.maxJobsPerRun, 10);
    if (Number.isFinite(siteLimit)) return siteLimit;

    const globalLimit = Number.parseInt(this.config.maxJobsPerRun, 10);
    return Number.isFinite(globalLimit) ? globalLimit : 10;
  }

  async fetchJson(url, options = {}) {
    const response = await this.fetchWithTimeout(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...browserHeaders,
        ...(options.headers || {})
      }
    });

    return response.json();
  }

  async fetchText(url, options = {}) {
    const response = await this.fetchWithTimeout(url, {
      ...options,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...browserHeaders,
        ...(options.headers || {})
      }
    });

    return response.text();
  }

  async fetchWithTimeout(url, options = {}) {
    const timeoutMs = Number.parseInt(options.timeoutMs ?? this.siteConfig.timeoutMs, 10) || 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`${this.siteName} request failed: ${response.status} ${response.statusText}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async log(message) {
    await appendLog(`[${this.siteName}] ${message}`, this.config);
  }
}

export function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(compactText).filter(Boolean);
  }
  return String(value)
    .split(/[,|;/]/)
    .map(compactText)
    .filter(Boolean);
}

export function normalizeJob(job, sourceSite) {
  return new BaseScraper(sourceSite).normalizeJob(job);
}

export function limitJobs(jobs, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return jobs;
  return jobs.slice(0, limit);
}

export function siteLimit(config, site) {
  const perSite = Number.parseInt(config.siteLimits?.[site], 10);
  if (Number.isFinite(perSite)) return perSite;
  return Number.parseInt(config.siteJobLimit ?? config.maxJobsPerRun ?? 10, 10);
}

export function createPlannedScraper(site) {
  return async function plannedScraper(config) {
    const scraper = new BaseScraper(site, config, { maxJobsPerRun: 0 });
    await scraper.log('Scraper is registered but not implemented yet; skipping.');
    return [];
  };
}

const defaultUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const browserHeaders = {
  'User-Agent': defaultUserAgent,
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};
