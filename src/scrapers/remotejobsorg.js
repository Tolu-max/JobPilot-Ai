import { BaseScraper, normalizeList } from './baseScraper.js';

const DEFAULT_QUERIES = ['customer support', 'administrative assistant'];
const DEFAULT_MAX_AGE_DAYS = 30;

export class RemoteJobsOrgScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('remotejobsorg', config, siteConfig);
  }

  async fetchJobs() {
    const queries = normalizeList(this.siteConfig.queries || this.siteConfig.searchQueries);
    const categories = normalizeList(this.siteConfig.categories);
    const searchQueries = queries.length ? queries : DEFAULT_QUERIES;
    const requests = [];

    for (const query of searchQueries) {
      requests.push({ search: query });
    }
    for (const category of categories) {
      requests.push({ category });
    }
    if (!requests.length) requests.push({});

    const jobs = [];
    for (const request of requests) {
      try {
        jobs.push(...await this.fetchPage(request));
      } catch (error) {
        await this.log(`API request skipped (${describeFilters(request)}): ${error.message}`);
      }
    }

    await this.log(`API returned ${jobs.length} raw job(s).`);
    return jobs;
  }

  async fetchPage(filters = {}) {
    const payload = await this.fetchJson(this.buildApiUrl(filters));
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  buildApiUrl(filters = {}) {
    const baseUrl = this.siteConfig.apiUrl || 'https://remotejobs.org/api/v1/jobs';
    const params = new URLSearchParams({
      limit: String(Number.parseInt(this.siteConfig.pageSize, 10) || 25)
    });

    if (filters.search) params.set('search', filters.search);
    if (filters.category) params.set('category', filters.category);

    return `${baseUrl}?${params.toString()}`;
  }

  normalizeJob(rawJob) {
    const salary = rawJob.salary_text || formatSalary(rawJob);
    const company = typeof rawJob.company === 'object' ? rawJob.company?.name : rawJob.company;
    const category = typeof rawJob.category === 'object' ? rawJob.category?.name : rawJob.category;
    const categorySlug = typeof rawJob.category === 'object' ? rawJob.category?.slug : '';

    return super.normalizeJob({
      source: 'remotejobsorg',
      source_site: 'remotejobsorg',
      sourceJobId: rawJob.id,
      title: rawJob.title,
      company,
      location: rawJob.location || 'Remote',
      jobType: rawJob.type,
      salary,
      description: rawJob.description,
      requirements: [category, categorySlug].filter(Boolean).join(', '),
      requiredSkills: [category].filter(Boolean),
      tags: [category, categorySlug].filter(Boolean),
      applicationUrl: rawJob.apply_url || rawJob.url,
      postedAt: rawJob.posted_at,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    if (this.siteConfig.remoteOnly !== false && !isRemote(job)) return false;
    if (!matchesLocationPolicy(job, this.siteConfig)) return false;
    if (!isRecent(job.postedAt, Number.parseInt(this.siteConfig.maxAgeDays, 10) || DEFAULT_MAX_AGE_DAYS)) return false;
    return true;
  }
}

function isRemote(job) {
  return /remote|worldwide|anywhere/i.test(`${job.location || ''} ${job.description || ''}`);
}

function isRecent(postedAt, maxAgeDays) {
  if (!postedAt) return true;
  const posted = new Date(postedAt).getTime();
  if (!Number.isFinite(posted)) return true;
  return Date.now() - posted <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function matchesLocationPolicy(job, siteConfig = {}) {
  const preferred = normalizeList(siteConfig.preferredLocations || siteConfig.allowedLocations || siteConfig.country);
  if (!preferred.length) return true;

  const preferredText = preferred.join('|');
  const raw = job.raw || {};
  const locationText = [
    job.location,
    raw.location,
    raw.country,
    raw.applicantLocationRequirements?.name,
    raw.applicant_location_requirements?.name,
    raw.jobLocation?.address?.addressCountry,
    raw.jobLocation?.address?.addressLocality
  ].filter(Boolean).join(' ');

  if (new RegExp(preferredText, 'i').test(locationText)) return true;
  if (/worldwide|anywhere|global|international|fully remote/i.test(locationText)) return true;

  const restrictedCountries = /\b(US|USA|United States|Canada|UK|United Kingdom|India|Australia|New Zealand|EU|Europe)\b/i;
  if (restrictedCountries.test(locationText)) return false;

  return siteConfig.allowOtherLocationsWhenNoPreferred === true;
}

function formatSalary(rawJob = {}) {
  const min = Number.parseInt(rawJob.salary_min, 10);
  const max = Number.parseInt(rawJob.salary_max, 10);
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max}`;
  if (Number.isFinite(min)) return `${min}+`;
  if (Number.isFinite(max)) return `up to ${max}`;
  return '';
}

function describeFilters(filters = {}) {
  return Object.entries(filters).map(([key, value]) => `${key}=${value}`).join(', ') || 'default';
}

export async function scrapeRemoteJobsOrgJobs(config, siteConfig = {}) {
  return new RemoteJobsOrgScraper(config, siteConfig).scrape();
}
