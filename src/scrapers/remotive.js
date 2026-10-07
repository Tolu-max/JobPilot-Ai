import { BaseScraper } from './baseScraper.js';

export class RemotiveScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('remotive', config, siteConfig);
  }

  async fetchJobs() {
    const endpoint = this.siteConfig.apiUrl || 'https://remotive.com/api/remote-jobs';
    const payload = await this.fetchJson(endpoint);
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const limit = this.resolveMaxJobsPerRun();
    const jobsToEnrich = limit > 0 ? jobs.slice(0, limit) : jobs.slice(0, 20);
    return Promise.all(jobsToEnrich.map((job) => this.enrichApplyUrl(job)));
  }

  async enrichApplyUrl(rawJob) {
    if (!rawJob?.url) return rawJob;
    try {
      const html = await this.fetchText(rawJob.url);
      const applyUrl = extractApplyUrl(html);
      return applyUrl ? { ...rawJob, applyUrl } : rawJob;
    } catch {
      return rawJob;
    }
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      source: 'remotive',
      source_site: 'remotive',
      sourceJobId: rawJob.id,
      title: rawJob.title,
      company: rawJob.company_name,
      location: rawJob.candidate_required_location || 'Remote',
      jobType: rawJob.job_type,
      description: rawJob.description,
      requiredSkills: rawJob.tags,
      tags: rawJob.tags,
      applicationUrl: rawJob.applyUrl || rawJob.url,
      postedAt: rawJob.publication_date,
      raw: rawJob
    });
  }
}

function extractApplyUrl(html) {
  const match = String(html || '').match(/href="([^"]+)"[^>]*>\s*Apply for this position/i);
  return match ? decodeEntities(match[1]) : '';
}

function decodeEntities(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function scrapeRemotiveJobs(config, siteConfig = {}) {
  return new RemotiveScraper(config, siteConfig).scrape();
}
