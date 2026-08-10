import { BaseScraper, normalizeList } from './baseScraper.js';
import { matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';

export class ArbeitnowScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('arbeitnow', config, siteConfig);
  }

  async fetchJobs() {
    const endpoint = this.siteConfig.apiUrl || 'https://www.arbeitnow.com/api/job-board-api';
    const payload = await this.fetchJson(endpoint);
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      source: 'arbeitnow',
      source_site: 'arbeitnow',
      sourceJobId: rawJob.slug,
      title: rawJob.title,
      company: rawJob.company_name,
      location: rawJob.location || (rawJob.remote ? 'Remote' : ''),
      jobType: normalizeList(rawJob.job_types).join(', '),
      description: rawJob.description,
      requiredSkills: rawJob.tags,
      tags: [...normalizeList(rawJob.tags), rawJob.remote ? 'Remote' : ''].filter(Boolean),
      applicationUrl: rawJob.url,
      postedAt: rawJob.created_at,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

export async function scrapeArbeitnowJobs(config, siteConfig = {}) {
  return new ArbeitnowScraper(config, siteConfig).scrape();
}
