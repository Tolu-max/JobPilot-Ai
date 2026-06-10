import { BaseScraper } from './baseScraper.js';

export class AshbyScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('ashby', config, siteConfig);
  }

  async fetchJobs() {
    const boards = this.siteConfig.boards || ['close.com', 'n8n', 'firecrawl', 'openrouter'];
    let allJobs = [];

    for (const board of boards) {
      const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
      try {
        const payload = await this.fetchJson(endpoint);
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        
        // Tag them with the board they came from so we can generate the right apply URL
        jobs.forEach(job => {
          job._board = board;
        });

        allJobs = allJobs.concat(jobs);
      } catch (err) {
        // Ignore board fetch errors so one bad board doesn't crash the scraper
        continue;
      }
    }

    const limit = this.resolveMaxJobsPerRun();
    return limit > 0 ? allJobs.slice(0, limit) : allJobs.slice(0, 20);
  }

  normalizeJob(rawJob) {
    const applyUrl = rawJob.applicationFormUrl || `https://jobs.ashbyhq.com/${rawJob._board}/${rawJob.id}/application`;
    
    // Convert Ashby's HTML description to plain text roughly, or use their descriptionPlain if available
    let description = rawJob.descriptionPlain || rawJob.descriptionHtml || '';

    // Handle departments/teams for skills/tags mapping
    const tags = [];
    if (rawJob.department) tags.push(rawJob.department);
    if (rawJob.team) tags.push(rawJob.team);

    return super.normalizeJob({
      source: 'ashby',
      source_site: 'ashby',
      sourceJobId: rawJob.id,
      title: rawJob.title,
      company: rawJob._board, // The company is the board name
      location: rawJob.location || 'Remote',
      jobType: rawJob.isRemote ? 'Remote' : 'Full-Time',
      description,
      requiredSkills: tags.join(', '),
      tags,
      applicationUrl: applyUrl,
      postedAt: rawJob.publishedAt || new Date().toISOString(),
      raw: rawJob
    });
  }
}

export async function scrapeAshbyJobs(config, siteConfig = {}) {
  return new AshbyScraper(config, siteConfig).scrape();
}
