import { BaseScraper, normalizeList } from './baseScraper.js';
import { compactText } from '../utils.js';
import { matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';

const DEFAULT_CATEGORIES = ['Customer Service', 'Administrative'];

export class TheMuseScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('themuse', config, siteConfig);
  }

  async fetchJobs() {
    const categories = normalizeList(this.siteConfig.categories || this.siteConfig.category);
    const targets = categories.length ? categories : DEFAULT_CATEGORIES;
    const jobs = [];

    for (const category of targets) {
      const pageSize = Math.min(Number.parseInt(this.siteConfig.pageSize, 10) || this.resolveMaxJobsPerRun() || 20, 20);
      const endpoint = buildMuseUrl(this.siteConfig, category, pageSize);
      try {
        const payload = await this.fetchJson(endpoint);
        jobs.push(...(Array.isArray(payload?.results) ? payload.results : []));
      } catch (error) {
        await this.log(`Category skipped (${category}): ${error.message}`);
      }
    }

    return jobs;
  }

  normalizeJob(rawJob) {
    const locations = Array.isArray(rawJob.locations) ? rawJob.locations.map((item) => item?.name).filter(Boolean) : [];
    const categories = Array.isArray(rawJob.categories) ? rawJob.categories.map((item) => item?.name).filter(Boolean) : [];

    return super.normalizeJob({
      source: 'themuse',
      source_site: 'themuse',
      sourceJobId: rawJob.id,
      title: rawJob.name,
      company: rawJob.company?.name,
      location: locations.join(', ') || 'Remote',
      description: rawJob.contents,
      requirements: rawJob.levels?.map((item) => item?.name).filter(Boolean).join(', '),
      requiredSkills: categories,
      tags: [...categories, ...locations],
      applicationUrl: rawJob.refs?.landing_page || rawJob.refs?.jobs_page || rawJob.refs?.company || '',
      postedAt: rawJob.publication_date,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

function buildMuseUrl(siteConfig, category, pageSize) {
  const baseUrl = siteConfig.apiUrl || 'https://www.themuse.com/api/public/jobs';
  const params = new URLSearchParams({
    page: String(Number.parseInt(siteConfig.page, 10) || 1),
    category,
    location: siteConfig.location || 'Remote',
    descending: 'true',
    items_per_page: String(pageSize)
  });
  return `${baseUrl}?${params.toString()}`;
}

export async function scrapeTheMuseJobs(config, siteConfig = {}) {
  return new TheMuseScraper(config, siteConfig).scrape();
}
