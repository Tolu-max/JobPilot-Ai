import { BaseScraper, normalizeList } from './baseScraper.js';
import { matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';

export class JobicyScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('jobicy', config, siteConfig);
  }

  async fetchJobs() {
    const limit = this.resolveMaxJobsPerRun() || 25;
    const endpoint = buildApiUrl(this.siteConfig, limit);
    const payload = await this.fetchJson(endpoint);
    return Array.isArray(payload?.jobs) ? payload.jobs : [];
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      source: 'jobicy',
      source_site: 'jobicy',
      sourceJobId: rawJob.id,
      title: rawJob.jobTitle,
      company: rawJob.companyName,
      location: rawJob.jobGeo || 'Remote',
      jobType: normalizeList(rawJob.jobType).join(', '),
      description: rawJob.jobDescription || rawJob.jobExcerpt,
      requirements: rawJob.jobExcerpt,
      requiredSkills: rawJob.jobIndustry,
      tags: [...normalizeList(rawJob.jobIndustry), compactTextSafe(rawJob.jobLevel), compactTextSafe(rawJob.jobGeo)].filter(Boolean),
      applicationUrl: rawJob.url,
      postedAt: rawJob.pubDate || rawJob.createdAt || rawJob.updatedAt,
      salary: rawJob.annualSalaryMin && rawJob.annualSalaryMax ? `${rawJob.annualSalaryMin}-${rawJob.annualSalaryMax}` : '',
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

function buildApiUrl(siteConfig, count) {
  const baseUrl = siteConfig.apiUrl || 'https://jobicy.com/api/v2/remote-jobs';
  const params = new URLSearchParams({ count: String(count) });
  const tag = normalizeList(siteConfig.tag || siteConfig.tags || siteConfig.category)[0];
  if (tag) params.set('tag', tag);
  return `${baseUrl}?${params.toString()}`;
}

function compactTextSafe(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function scrapeJobicyJobs(config, siteConfig = {}) {
  return new JobicyScraper(config, siteConfig).scrape();
}
