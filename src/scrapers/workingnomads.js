import { BaseScraper, normalizeList } from './baseScraper.js';
import { matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';

export class WorkingNomadsScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('workingnomads', config, siteConfig);
  }

  async fetchJobs() {
    const limit = this.resolveMaxJobsPerRun() || 15;
    const body = {
      from: 0,
      size: limit,
      query: { bool: { must: [{ match_all: {} }] } },
      sort: [{ pub_date: { order: 'desc' } }]
    };
    const endpoint = this.siteConfig.apiUrl || 'https://www.workingnomads.com/jobsapi/_search';
    const payload = await this.fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    return Array.isArray(payload?.hits?.hits) ? payload.hits.hits.map((item) => item._source || item).filter(Boolean) : [];
  }

  normalizeJob(rawJob) {
    const tags = normalizeList(rawJob.tags || rawJob.keywords || rawJob.category_name);
    return super.normalizeJob({
      source: 'workingnomads',
      source_site: 'workingnomads',
      sourceJobId: rawJob.id,
      title: rawJob.title,
      company: rawJob.company,
      location: rawJob.location || rawJob.region || 'Remote',
      jobType: rawJob.position_type || '',
      description: rawJob.description,
      requirements: rawJob.description,
      requiredSkills: tags,
      tags: [...tags, rawJob.category_name].filter(Boolean),
      applicationUrl: rawJob.url || rawJob.apply_url || buildWorkingNomadsUrl(rawJob.slug),
      postedAt: rawJob.pub_date || rawJob.created_at,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

function buildWorkingNomadsUrl(slug) {
  return slug ? `https://www.workingnomads.com/jobs/${slug}` : '';
}

export async function scrapeWorkingNomadsJobs(config, siteConfig = {}) {
  return new WorkingNomadsScraper(config, siteConfig).scrape();
}
