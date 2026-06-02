import { BaseScraper, normalizeList } from './baseScraper.js';

const DEFAULT_QUERIES = ['javascript', 'web developer', 'customer support'];
const NIGERIA_UTC_OFFSET = 1;

export class HimalayasScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('himalayas', config, siteConfig);
  }

  async fetchJobs() {
    const queries = normalizeList(this.siteConfig.queries || this.siteConfig.searchQueries);
    const searchQueries = queries.length ? queries : DEFAULT_QUERIES;
    const pages = Math.max(1, Number.parseInt(this.siteConfig.pagesPerQuery, 10) || 1);
    const jobs = [];

    for (const query of searchQueries) {
      for (let page = 1; page <= pages; page += 1) {
        const payload = await this.fetchJson(this.buildSearchUrl(query, page));
        const pageJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        jobs.push(...pageJobs);
      }
    }

    await this.log(`API returned ${jobs.length} raw job(s) for ${searchQueries.length} query/queries.`);
    return jobs;
  }

  buildSearchUrl(query, page) {
    const baseUrl = this.siteConfig.apiUrl || 'https://himalayas.app/jobs/api/search';
    const params = new URLSearchParams({
      q: query,
      sort: this.siteConfig.sort || 'recent',
      page: String(page)
    });

    const country = this.siteConfig.country || this.siteConfig.preferredCountry || 'Nigeria';
    if (country) params.set('country', country);

    return `${baseUrl}?${params.toString()}`;
  }

  normalizeJob(rawJob) {
    const locationRestrictions = normalizeList(rawJob.locationRestrictions);
    const timezoneRestrictions = Array.isArray(rawJob.timezoneRestrictions) ? rawJob.timezoneRestrictions : [];
    const location = locationRestrictions.length ? `Remote (${locationRestrictions.join(', ')})` : 'Remote worldwide';
    const salary = formatSalary(rawJob);
    const himalayasUrl = rawJob.applicationLink || rawJob.guid;
    const externalApplyUrl = resolveExternalApplyUrl(rawJob, himalayasUrl, this.siteConfig);

    return super.normalizeJob({
      source: 'himalayas',
      source_site: 'himalayas',
      sourceJobId: rawJob.guid || rawJob.applicationLink,
      title: rawJob.title,
      company: rawJob.companyName,
      location,
      jobType: rawJob.employmentType,
      salary,
      description: rawJob.description || rawJob.excerpt,
      requirements: normalizeList(rawJob.categories).join(', '),
      requiredSkills: rawJob.categories,
      tags: [
        ...normalizeList(rawJob.categories),
        ...normalizeList(rawJob.parentCategories),
        ...normalizeList(rawJob.seniority)
      ],
      applicationUrl: externalApplyUrl || himalayasUrl,
      postedAt: formatUnixDate(rawJob.pubDate),
      raw: {
        ...rawJob,
        himalayasUrl,
        externalApplyUrl,
        locationRestrictions,
        timezoneRestrictions
      }
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;

    const raw = job.raw || {};
    if (this.siteConfig.nigeriaOnly !== false && !allowsNigeria(raw)) return false;
    if (this.siteConfig.lagosTimezoneCompatible !== false && !allowsNigeriaTimezone(raw)) return false;

    return true;
  }
}

function resolveExternalApplyUrl(rawJob = {}, himalayasUrl, siteConfig = {}) {
  const embeddedUrl = extractEmbeddedApplyUrl(rawJob);
  if (embeddedUrl) return embeddedUrl;

  const map = siteConfig.externalApplyUrls || {};
  if (!himalayasUrl || !map || typeof map !== 'object') return '';

  const exact = map[himalayasUrl];
  if (exact) return exact;

  const slug = rawJob.companySlug || rawJob.companyName || '';
  if (slug && map[slug]) return map[slug];

  const titleKey = `${slug}:${rawJob.title || ''}`;
  if (map[titleKey]) return map[titleKey];

  const normalizedUrl = String(himalayasUrl).replace(/\/+$/, '');
  for (const [key, value] of Object.entries(map)) {
    if (String(key).replace(/\/+$/, '') === normalizedUrl) return value;
  }

  return '';
}

function extractEmbeddedApplyUrl(rawJob = {}) {
  const text = [rawJob.description, rawJob.excerpt].filter(Boolean).join(' ');
  const matches = [...String(text).matchAll(/https?:\/\/[^"'<>\s)]+/g)].map((match) => match[0]);
  return matches.find((url) => /applytojob|greenhouse|lever|ashbyhq|workable|bamboohr|recruitee|smartrecruiters|jobs\.ashbyhq|boards\.greenhouse/i.test(url)) || '';
}

function allowsNigeria(rawJob = {}) {
  const restrictions = normalizeList(rawJob.locationRestrictions);
  return restrictions.length === 0 || restrictions.some((country) => country.toLowerCase() === 'nigeria');
}

function allowsNigeriaTimezone(rawJob = {}) {
  const restrictions = Array.isArray(rawJob.timezoneRestrictions) ? rawJob.timezoneRestrictions : [];
  return restrictions.length === 0 || restrictions.some((offset) => Number(offset) === NIGERIA_UTC_OFFSET);
}

function formatUnixDate(value) {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds)) return '';
  return new Date(seconds * 1000).toISOString();
}

function formatSalary(rawJob = {}) {
  const min = Number.parseInt(rawJob.minSalary, 10);
  const max = Number.parseInt(rawJob.maxSalary, 10);
  const currency = rawJob.currency || 'USD';

  if (Number.isFinite(min) && Number.isFinite(max)) return `${currency} ${min}-${max}`;
  if (Number.isFinite(min)) return `${currency} ${min}+`;
  if (Number.isFinite(max)) return `${currency} up to ${max}`;
  return '';
}

export async function scrapeHimalayasJobs(config, siteConfig = {}) {
  return new HimalayasScraper(config, siteConfig).scrape();
}
